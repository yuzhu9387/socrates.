import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const SESSION_COOKIE='socrates_session';
export const hashSecret=secret=>createHash('sha256').update(secret).digest('hex');
export const httpError=(status,code,message,details)=>Object.assign(new Error(message),{status,code,...(details?{details}:{})});
export async function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 const derived=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt$32768$8$1$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password,encoded){
 try{
  const [name,n,r,p,salt,hex]=encoded.split('$');
  if(name!=='scrypt'||n!=='32768'||r!=='8'||p!=='1'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(hex))return false;
  const derived=await scrypt(password,salt,64,{N:+n,r:+r,p:+p,maxmem:64*1024*1024});
  return timingSafeEqual(derived,Buffer.from(hex,'hex'));
 }catch{return false;}
}
export function validateCredentials(body){
 const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw httpError(400,'INVALID_EMAIL','Enter a valid email address.');
 if(typeof body?.password!=='string'||body.password.length<12||Buffer.byteLength(body.password)>1024)throw httpError(400,'INVALID_PASSWORD','Use a password of at least 12 characters and at most 1,024 bytes.');
 return {email,password:body.password};
}
export function readCookie(req,name){
 const pair=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));
 if(!pair)return null;try{return decodeURIComponent(pair.slice(name.length+1))}catch{return null;}
}
export function makeAuthentication(pool){
 return async(req,res,next)=>{
  try{
   const bearer=req.get('authorization');
   if(bearer){
    if(!/^Bearer sct_[A-Za-z0-9_-]{43}$/.test(bearer))throw httpError(401,'UNAUTHORIZED','Invalid API token.');
    const token=bearer.slice(7);
    const {rows}=await pool.query(`SELECT c.id,c.user_id,c.scopes,u.email FROM api_connections c JOIN users u ON u.id=c.user_id WHERE c.token_hash=$1 AND c.revoked_at IS NULL`,[hashSecret(token)]);
    if(!rows.length)throw httpError(401,'UNAUTHORIZED','API token has expired or was revoked.');
    const c=rows[0];if(!validScopes(c.scopes))throw httpError(401,'UNAUTHORIZED','This token has invalid scopes. Create a new connection in Settings.');req.auth={userId:c.user_id,email:c.email,kind:'token',scopes:c.scopes,connectionId:c.id};
    await pool.query('UPDATE api_connections SET last_used_at=now() WHERE id=$1',[c.id]);
   }else{
    const secret=readCookie(req,SESSION_COOKIE);
    if(secret&&/^[A-Za-z0-9_-]{43}$/.test(secret)){
     const {rows}=await pool.query(`SELECT s.user_id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[hashSecret(secret)]);
     if(rows.length)req.auth={userId:rows[0].user_id,email:rows[0].email,kind:'session',scopes:['read','write','purge'],sessionHash:hashSecret(secret)};
    }
   }
   const expectedAccount=req.get('X-Socrates-Account');
   const publicAuth=/^\/auth\/(status|setup|login|register)\/?$/.test(req.path);
   if(req.auth&&expectedAccount!==undefined&&!publicAuth&&expectedAccount!==req.auth.userId)throw httpError(409,'ACCOUNT_CHANGED','The signed-in account changed. Sign in again to continue.');
   next();
  }catch(error){next(error)}
 };
}
export function csrfProtection(origin){
 const allowed=new URL(origin).origin;
 return(req,res,next)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method)||req.auth?.kind==='token')return next();
  if(req.get('X-Socrates-CSRF')!=='1')return next(httpError(403,'CSRF_REQUIRED','The request is missing its CSRF header.'));
  const supplied=req.get('origin');
  if(supplied!==undefined&&supplied!==allowed)return next(httpError(403,'ORIGIN_DENIED','This request did not come from the application origin.'));
  if(req.get('sec-fetch-site')==='cross-site')return next(httpError(403,'ORIGIN_DENIED','Cross-site requests are not allowed.'));
  next();
 };
}
export function requireAuth(req,res,next){if(!req.auth)return next(httpError(401,'UNAUTHORIZED','Sign in to continue.'));next();}
export const requireScope=scope=>(req,res,next)=>{
 if(!req.auth)return next(httpError(401,'UNAUTHORIZED','Sign in to continue.'));
 if(!req.auth.scopes.includes(scope))return next(httpError(403,'INSUFFICIENT_SCOPE',`This connection requires the ${scope} scope.`));
 next();
};
export function requireSession(req,res,next){if(req.auth?.kind!=='session')return next(httpError(403,'SESSION_REQUIRED','Manage account connections from a signed-in browser.'));next();}
export const validScopes=scopes=>Array.isArray(scopes)&&scopes.length>0&&scopes.length<=3&&new Set(scopes).size===scopes.length&&scopes.every(s=>['read','write','purge'].includes(s))&&scopes.includes('read')&&(!scopes.includes('purge')||scopes.includes('write'));
export const publicUser=auth=>({id:auth.userId,email:auth.email});
export async function createSession(pool,userId,res,secureCookies=false){
 const secret=randomBytes(32).toString('base64url');
 await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[hashSecret(secret),userId]);
 res.cookie(SESSION_COOKIE,secret,{httpOnly:true,sameSite:'lax',secure:secureCookies,path:'/',maxAge:30*86400*1000});
}
export async function createAccount(pool,{email,password},onlyFirst=true){
 const passwordHash=await hashPassword(password);const db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(736627,1)');
  if(onlyFirst&&(await db.query('SELECT 1 FROM users LIMIT 1')).rowCount)throw httpError(403,'SETUP_CLOSED','An account already exists. Sign in to continue.');
  const id=randomUUID();await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,email,passwordHash]);await db.query('INSERT INTO workspaces(owner_id) VALUES($1)',[id]);await db.query('COMMIT');return{id,email};
 }catch(error){await db.query('ROLLBACK');if(error.code==='23505')throw httpError(409,'EMAIL_EXISTS','An account with this email already exists.');throw error;}finally{db.release()}
}
export async function logActivity(pool,ownerId,source,action,objectType=null,objectId=null){
 await pool.query('INSERT INTO activity_events(id,owner_id,source,action,object_type,object_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),ownerId,source,action,objectType,objectId]);
}
