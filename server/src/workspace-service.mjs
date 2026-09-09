import {createHash,randomUUID} from 'node:crypto';
import {validateWorkspace,workspaceError,sameValue} from './workspace-validation.mjs';
import {projectWorkspace,persistWorkspace} from './workspace-projection.mjs';

const fail=(status,code,message,extras)=>{throw workspaceError(status,code,message,extras);};
const revisions=m=>[...(m?.history||[]),...(m?.saved?[m.saved]:[])];
const withoutLabel=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='label'));
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const stable=v=>Array.isArray(v)?v.map(stable):object(v)?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,stable(v[k])])):v;
const requestHash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
function references(map,noteId){return map?.nodes?.some(n=>n?.noteId===noteId)||revisions(map).some(r=>(Array.isArray(r?.notes)&&r.notes.some(n=>n?.id===noteId))||(Array.isArray(r?.nodes)&&r.nodes.some(n=>n?.noteId===noteId)));}
function removedPersistentContent(before,after){
 const notes=new Set(after.notes.map(n=>n.id)),maps=new Map(after.maps.map(m=>[m.id,m]));
 if(before.notes.some(n=>!notes.has(n.id)))return true;
 return before.maps.some(m=>{
  const next=maps.get(m.id);if(!next)return true;
  const remaining=new Set(revisions(next).map(r=>r.number));
  return revisions(m).some(r=>!remaining.has(r.number));
 });
}
function canonicalResult(submitted,persisted,result){
 // Callbacks commonly return the note/map they just edited. Resolve those
 // references against PostgreSQL's canonical projection; keep custom metadata.
 if(!object(result))return result===undefined?null:result;
 for(const collection of ['notes','maps'])if(submitted[collection].includes(result))return persisted[collection].find(item=>item.id===result.id);
 for(const map of submitted.maps){
  const saved=persisted.maps.find(m=>m.id===map.id);
  for(const collection of ['nodes','edges'])if(map[collection].includes(result))return saved[collection].find(item=>item.id===result.id);
 }
 return result;
}
function prepareWorkspace(raw,current,mode){
 if(!['edit','import','replace'].includes(mode))fail(400,'VALIDATION_ERROR','Unknown workspace commit mode.');
 if(mode==='import'&&(current.notes.length||current.maps.length||current.tags.length))fail(409,'WORKSPACE_NOT_EMPTY','Import requires an empty workspace. Use explicit replacement to restore a full backup.');
 if(mode!=='edit')return validateWorkspace(raw,{legacy:true});
 if(!object(raw)||!Array.isArray(raw.notes)||!Array.isArray(raw.maps))fail(400,'VALIDATION_ERROR','Workspace notes and maps must be arrays.');
 for(const map of raw.maps){
  if(!object(map)||!Array.isArray(map.nodes)||!Array.isArray(map.edges)||(map.history!==undefined&&!Array.isArray(map.history)))fail(400,'VALIDATION_ERROR','Map nodes, edges and history must be arrays.');
 }
 const ids=new Set(raw.notes.map(n=>n?.id));
 for(const n of current.notes)if(!ids.has(n.id)){const refs=raw.maps.filter(m=>references(m,n.id));if(refs.length)fail(409,'NOTE_REFERENCED','Remove this note from all boards and saved versions before permanently deleting it.',{details:{noteId:n.id,mapIds:refs.map(m=>m.id)}});}
 // Validate the mutable draft first. Client-provided frozen bodies for a new
 // save are never used to construct its immutable revision.
 const oldMaps=new Map(current.maps.map(m=>[m.id,m]));
 const draft=validateWorkspace({...raw,maps:raw.maps.map(m=>{
  const draftMap={...m,saved:null,history:[]};
  if(Array.isArray(m?.noteOrder)&&Array.isArray(m.nodes)){
   const previousRefs=new Set(oldMaps.get(m.id)?.nodes.filter(n=>n.type==='note').map(n=>n.noteId)||[]);
   const currentRefs=new Set(m.nodes.filter(n=>n?.type==='note').map(n=>n.noteId));
   draftMap.noteOrder=m.noteOrder.filter(noteId=>currentRefs.has(noteId)||!previousRefs.has(noteId));
  }
  return draftMap;
 })},{existingNotes:new Map(current.notes.map(n=>[n.id,n]))});
 const notes=new Map(draft.notes.map(n=>[n.id,n]));
 draft.maps.forEach((map,index)=>{
  const requested=raw.maps[index],old=oldMaps.get(map.id),previous=new Map(revisions(old).map(r=>[r.number,r]));
  if(requested.history!==undefined&&!Array.isArray(requested.history))fail(400,'VALIDATION_ERROR','Map history must be an array.');
  if(requested.saved!==undefined&&requested.saved!==null&&!object(requested.saved))fail(400,'VALIDATION_ERROR','Saved revision must be an object.');
  const history=requested.history||[],newRevisions=[...history,...(requested.saved?[requested.saved]:[])].filter(r=>!previous.has(r?.number));
  if(newRevisions.length>1||newRevisions.some(r=>r!==requested.saved))fail(400,'INVALID_REVISION','Only one new selected revision may be saved in a commit. Import historical revisions through import or replacement.');
  const resolve=(incoming,isSaved)=>{
   if(!object(incoming)||!Number.isSafeInteger(incoming.number)||incoming.number<1)fail(400,'VALIDATION_ERROR','Revision number must be a positive integer.');
   const existing=previous.get(incoming.number);
   if(existing){if(!sameValue(withoutLabel(incoming),withoutLabel(existing)))fail(409,'IMMUTABLE_REVISION','Saved revision contents are immutable. Create a new revision to save changes.',{details:{mapId:map.id,number:incoming.number}});return {...structuredClone(existing),...(incoming.label!==undefined?{label:incoming.label}:{})};}
   const maximum=Math.max(0,...previous.keys());if(!isSaved||incoming.number!==maximum+1)fail(400,'INVALID_REVISION',`The next saved revision number must be ${maximum+1}.`);
   const references=[...new Set(map.nodes.filter(n=>n.type==='note').map(n=>n.noteId))];
   const used=[...new Set([...(map.noteOrder||[]).filter(id=>references.includes(id)),...references])];const frozen=used.map(id=>notes.get(id));
   if(frozen.some(n=>!n||n.deleted))fail(409,'SOURCE_NOTE_UNAVAILABLE','Restore or remove deleted source notes before saving a revision.');
   const counts=new Map();for(const n of frozen)for(const t of n.tags)counts.set(t,(counts.get(t)||0)+1);
   const tagOrder=[...new Set([...map.tagOrder.filter(t=>counts.has(t)),...[...counts].sort((a,b)=>b[1]-a[1]).map(([t])=>t)])];
   return {number:incoming.number,date:new Date().toISOString(),name:map.name,summary:map.summary,description:map.description,nodes:structuredClone(map.nodes),edges:structuredClone(map.edges),notes:structuredClone(frozen),tagOrder,...(map.noteOrder?{noteOrder:structuredClone(map.noteOrder)}:{}),...(incoming.label!==undefined?{label:incoming.label}:{})};
  };
  map.history=history.map(r=>resolve(r,false));map.saved=requested.saved?resolve(requested.saved,true):null;
 });
 return validateWorkspace(draft,{existingNotes:new Map(current.notes.map(n=>[n.id,n]))});
}

export async function readWorkspace(pool,ownerId){
 const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await projectWorkspace(client,ownerId);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function transaction(pool,ownerId,options,mutator){
 const {expectedRevision,idempotencyKey,source='ui',mode='edit',action='workspace.commit'}=options;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail(400,'EXPECTED_REVISION_REQUIRED','expectedRevision must be a nonnegative integer.');
 if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>200||/[\u0000-\u001f]/u.test(idempotencyKey)))fail(400,'VALIDATION_ERROR','Invalid Idempotency-Key.');
 if(typeof source!=='string'||source.length>120||!source)fail(400,'VALIDATION_ERROR','Invalid activity source.');
 const actionName=typeof action==='string'?action:action?.name;
 if(typeof actionName!=='string'||actionName.length>160||!actionName)fail(400,'VALIDATION_ERROR','Invalid action.');
 for(const field of ['objectType','objectId'])if(object(action)&&action[field]!=null&&(typeof action[field]!=='string'||action[field].length>200))fail(400,'VALIDATION_ERROR',`Invalid ${field}.`);
 const hash=idempotencyKey?requestHash({expectedRevision,source,mode,action,...(!mutator?{data:options.data}:{})}):null;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('SET LOCAL lock_timeout = \'10s\'');await client.query('SET CONSTRAINTS ALL DEFERRED');
  const locked=(await client.query('SELECT revision,preferences_json FROM workspaces WHERE owner_id=$1 FOR UPDATE',[ownerId])).rows[0];
  if(!locked)fail(404,'WORKSPACE_NOT_FOUND','Workspace not found.');
  if(idempotencyKey){const replay=(await client.query('SELECT request_hash,response_json FROM idempotency_records WHERE owner_id=$1 AND key=$2',[ownerId,idempotencyKey])).rows[0];if(replay){if(replay.request_hash!==hash)fail(409,'IDEMPOTENCY_CONFLICT','This idempotency key was already used for a different request.');await client.query('COMMIT');return replay.response_json;}}
  const revision=Number(locked.revision);if(revision!==expectedRevision)fail(409,'VERSION_CONFLICT','The workspace changed on the server. Reload server data before saving again.',{currentRevision:revision});
  if(revision>=Number.MAX_SAFE_INTEGER)fail(409,'REVISION_OVERFLOW','Workspace revision limit reached.');
  const current=await projectWorkspace(client,ownerId,locked);let submitted=options.data,result;
  if(mutator){submitted=structuredClone(current.data);result=await mutator(submitted);}
  const data=prepareWorkspace(submitted,current.data,mode);
  await persistWorkspace(client,ownerId,data,{replace:mode!=='edit'});
  // Retry payloads contain historical projections. Permanent deletion must
  // remove these copies too, before caching the current (post-purge) response.
  if(mode==='replace'||removedPersistentContent(current.data,data))await client.query('DELETE FROM idempotency_records WHERE owner_id=$1',[ownerId]);
  // Read canonical persisted values, including PostgreSQL timestamp formatting.
  const response=await projectWorkspace(client,ownerId);if(mutator)response.result=canonicalResult(submitted,response.data,result);
  await client.query('INSERT INTO activity_events(id,owner_id,source,action,object_type,object_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),ownerId,source,actionName,object(action)?action.objectType??null:'workspace',object(action)?action.objectId??null:null]);
  if(idempotencyKey)await client.query('INSERT INTO idempotency_records(owner_id,key,request_hash,response_json) VALUES($1,$2,$3,$4)',[ownerId,idempotencyKey,hash,JSON.stringify(response)]);
  await client.query('COMMIT');return response;
 }catch(error){await client.query('ROLLBACK');if(['23503','23505','23514','22P02','22007','22008','22021','22003'].includes(error.code)&&!error.status)throw workspaceError(400,'VALIDATION_ERROR','The change violates a database integrity constraint.');if(error.code==='55P03')throw workspaceError(503,'WORKSPACE_BUSY','Another workspace change is still running. Retry the same request.');throw error;}finally{client.release();}
}
export const commitWorkspace=(pool,ownerId,options)=>transaction(pool,ownerId,options,null);
export const mutateWorkspace=(pool,ownerId,options,mutator)=>{if(typeof mutator!=='function')throw new TypeError('mutator must be a function');return transaction(pool,ownerId,options,mutator);};
