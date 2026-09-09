import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createAccount,createSession,hashSecret,httpError,logActivity,publicUser,readCookie,requireAuth,requireScope,requireSession,SESSION_COOKIE,validateCredentials,verifyPassword,validScopes} from './auth.mjs';
export function pagination(query){
 const limit=query.limit===undefined?50:Number(query.limit),offset=query.offset===undefined?0:Number(query.offset);
 if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>1000000)throw httpError(400,'INVALID_PAGINATION','Use limit 1–200 and a nonnegative offset up to 1,000,000.');
 return {limit,offset};
}
const connectionSelect=`id,name,scopes,created_at AS "createdAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt"`;
const uuid=z.string().uuid();
function connectionId(req){return uuid.parse(req.params.id)}
export function accountRoutes({pool,secureCookies=false,allowRegistration=false}){
 const router=Router();
 const limit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({error:{code:'RATE_LIMITED',message:'Too many sign-in attempts. Try again later.'}})});
 router.get('/auth/status',async(req,res)=>res.json({setupRequired:!(await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount,authenticated:Boolean(req.auth),...(req.auth?{user:publicUser(req.auth)}:{})}));
 router.post('/auth/setup',limit,async(req,res)=>{
  const user=await createAccount(pool,validateCredentials(req.body),true);await createSession(pool,user.id,res,secureCookies);res.status(201).json({user});
 });
 if(allowRegistration)router.post('/auth/register',limit,async(req,res)=>{
  const user=await createAccount(pool,validateCredentials(req.body),false);await createSession(pool,user.id,res,secureCookies);res.status(201).json({user});
 });
 router.post('/auth/login',limit,async(req,res)=>{
  const {email,password}=validateCredentials(req.body);
  const {rows}=await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1',[email]);
  // A fixed valid hash makes unknown-account attempts perform the same expensive KDF.
  const dummy='scrypt$32768$8$1$00000000000000000000000000000000$'+('0'.repeat(128));
  const valid=await verifyPassword(password,rows[0]?.password_hash||dummy);
  if(!valid||!rows[0])throw httpError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
  const user={id:rows[0].id,email:rows[0].email};await createSession(pool,user.id,res,secureCookies);res.json({user});
 });
 router.post('/auth/logout',requireAuth,requireSession,async(req,res)=>{
  await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hashSecret(readCookie(req,SESSION_COOKIE)||'')]);
  res.clearCookie(SESSION_COOKIE,{httpOnly:true,sameSite:'lax',secure:secureCookies,path:'/'});res.json({ok:true});
 });
 router.get('/auth/me',requireAuth,(req,res)=>res.json({user:publicUser(req.auth)}));
 router.use('/connections',requireAuth,requireSession);
 router.get('/connections',async(req,res)=>{
  const {limit,offset}=pagination(req.query);const {rows}=await pool.query(`SELECT ${connectionSelect} FROM api_connections WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[req.auth.userId,limit,offset]);res.json({items:rows,limit,offset});
 });
 router.post('/connections',async(req,res)=>{
  const body=z.object({name:z.string().trim().min(1).max(100),scopes:z.array(z.enum(['read','write','purge'])).min(1).max(3).refine(validScopes,{message:'Every connection requires read; purge also requires write. Scopes must be unique.'})}).strict().parse(req.body);
  const token=`sct_${randomBytes(32).toString('base64url')}`,id=randomUUID();
  const {rows}=await pool.query(`INSERT INTO api_connections(id,user_id,name,token_hash,scopes) VALUES($1,$2,$3,$4,$5) RETURNING ${connectionSelect}`,[id,req.auth.userId,body.name,hashSecret(token),body.scopes]);
  await logActivity(pool,req.auth.userId,'ui','connection.create','connection',id);res.status(201).json({connection:rows[0],token});
 });
 router.patch('/connections/:id',async(req,res)=>{
  const id=connectionId(req),{name}=z.object({name:z.string().trim().min(1).max(100)}).strict().parse(req.body);
  const {rows}=await pool.query(`UPDATE api_connections SET name=$3 WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING ${connectionSelect}`,[id,req.auth.userId,name]);
  if(!rows.length)throw httpError(404,'NOT_FOUND','Connection not found.');await logActivity(pool,req.auth.userId,'ui','connection.rename','connection',id);res.json({connection:rows[0]});
 });
 router.delete('/connections/:id',async(req,res)=>{
  const id=connectionId(req),result=await pool.query('UPDATE api_connections SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2',[id,req.auth.userId]);
  if(!result.rowCount)throw httpError(404,'NOT_FOUND','Connection not found.');await logActivity(pool,req.auth.userId,'ui','connection.revoke','connection',id);res.json({ok:true});
 });
 router.get('/activity',requireScope('read'),async(req,res)=>{
  const {limit,offset}=pagination(req.query),q=String(req.query.q||'').slice(0,200);
  const args=[req.auth.userId,`%${q}%`];
  const {rows}=await pool.query(`SELECT id,source,action,object_type AS "objectType",object_id AS "objectId",created_at AS "createdAt" FROM activity_events WHERE owner_id=$1 AND action ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,[...args,limit,offset]);
  const count=await pool.query('SELECT count(*) FROM activity_events WHERE owner_id=$1 AND action ILIKE $2',args);res.json({items:rows,total:Number(count.rows[0].count),limit,offset});
 });
 router.delete('/activity/:id',requireScope('purge'),async(req,res)=>{
  const result=await pool.query('DELETE FROM activity_events WHERE id=$1 AND owner_id=$2',[uuid.parse(req.params.id),req.auth.userId]);if(!result.rowCount)throw httpError(404,'NOT_FOUND','Activity event not found.');res.json({ok:true});
 });
 router.delete('/activity',requireScope('purge'),async(req,res)=>{await pool.query('DELETE FROM activity_events WHERE owner_id=$1',[req.auth.userId]);res.json({ok:true})});
 return router;
}
