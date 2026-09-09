import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {readWorkspace,commitWorkspace,mutateWorkspace} from './workspace-service.mjs';
import {httpError,requireAuth,requireScope} from './auth.mjs';
import {pagination} from './routes-account.mjs';
const now=()=>new Date().toISOString();
const id=prefix=>`${prefix}-${randomUUID()}`;
const clone=value=>structuredClone(value);
const cleanTag=value=>value.trim().replace(/^#+/,'').trim();
const normalizeTag=value=>cleanTag(value).normalize('NFKC').toLowerCase();
function body(req){if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw httpError(400,'INVALID_BODY','Send a JSON object.');return req.body}
export function expectedRevision(req){
 const supplied=req.body?.expectedRevision??req.get('If-Match')?.replace(/^"|"$/g,'');
 if(supplied===undefined)throw httpError(428,'REVISION_REQUIRED','Supply expectedRevision or an If-Match header.');
 if(typeof supplied==='boolean'||supplied===null||supplied===''||!Number.isSafeInteger(Number(supplied))||Number(supplied)<0)throw httpError(400,'INVALID_REVISION','expectedRevision must be a nonnegative integer.');
 return Number(supplied);
}
function idempotencyKey(req){const key=req.get('Idempotency-Key');if(key!==undefined&&(!key.length||key.length>200))throw httpError(400,'INVALID_IDEMPOTENCY_KEY','Idempotency-Key must contain 1–200 characters.');return key;}
function find(list,idValue,label){const value=list.find(x=>x.id===idValue);if(!value)throw httpError(404,'NOT_FOUND',`${label} not found.`);return value}
function findMap(data,mapId){return find(data.maps,mapId,'Map')}
function pruneNoteOrder(map){if(map.noteOrder)map.noteOrder=map.noteOrder.filter(noteId=>map.nodes.some(n=>n.type==='note'&&n.noteId===noteId))}
function mapRevision(map,number){const revision=[...(map.history||[]),...(map.saved?[map.saved]:[])].find(r=>String(r.number)===String(number));if(!revision)throw httpError(404,'NOT_FOUND','Saved revision not found.');return revision}
function fields(object,names){return Object.fromEntries(names.filter(k=>Object.hasOwn(object,k)).map(k=>[k,object[k]]))}
function collection(req,items){
 const {limit,offset}=pagination(req.query),q=String(req.query.q||'').toLocaleLowerCase().slice(0,500);
 const filtered=items.filter(item=>!q||JSON.stringify(item).toLocaleLowerCase().includes(q));
 return {items:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset};
}
function visible(req,items){return items.filter(x=>req.query.deleted==='all'||(req.query.deleted==='true'?x.deleted:!x.deleted))}
function ensureTags(data,names){if(!Array.isArray(names))throw httpError(400,'INVALID_TAGS','tags must be an array.');for(const name of names){if(typeof name!=='string'||!name.trim()||name.length>100)throw httpError(400,'INVALID_TAG','Use nonempty tag names up to 100 characters.');if(!data.tags.includes(name))data.tags.push(name)}}
export function removalRequiresPurge(before,after){
 if(!after||!Array.isArray(after.notes)||!Array.isArray(after.maps))return false;
 if(before.notes.some(n=>!after.notes.some(x=>x.id===n.id))||before.maps.some(m=>!after.maps.some(x=>x.id===m.id)))return true;
 return before.maps.some(map=>{const next=after.maps.find(x=>x.id===map.id);const prior=[...(map.history||[]),...(map.saved?[map.saved]:[])];const kept=[...(next?.history||[]),...(next?.saved?[next.saved]:[])];return prior.some(r=>!kept.some(x=>x.number===r.number))});
}
export function workspaceRoutes({pool,origin}){
 const router=Router();router.use(requireAuth);
 const read=requireScope('read'),write=requireScope('write'),purge=requireScope('purge');
 const source=req=>req.auth.kind==='token'?(req.get('X-Socrates-Client')==='mcp'?'mcp':'api'):'ui';
 const link=(type,idValue)=>`${new URL(origin).origin}/#/${type==='maps'?'brainstorm':type}/${encodeURIComponent(idValue)}`;
 const present=(type,item)=>({...item,url:link(type,item.id)});
 const readData=req=>readWorkspace(pool,req.auth.userId);
 const mutate=async(req,res,name,objectType,objectId,change,status=200)=>{
  const result=await mutateWorkspace(pool,req.auth.userId,{expectedRevision:expectedRevision(req),idempotencyKey:idempotencyKey(req),source:source(req),action:{name,...(objectType?{objectType}:{}),...(objectId?{objectId}:{}),payload:{params:req.params,body:req.body||{}}}},change);
  res.status(status).json(result);
 };
 router.get('/workspace/status',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,counts:{notes:data.notes.filter(n=>!n.deleted).length,maps:data.maps.filter(m=>!m.deleted).length,tags:data.tags.length,trashedNotes:data.notes.filter(n=>n.deleted).length,trashedMaps:data.maps.filter(m=>m.deleted).length}})});
 router.get('/workspace',read,async(req,res)=>{const result=await readData(req);res.set('ETag',`"${result.revision}"`).json(result)});
 router.put('/workspace',write,async(req,res)=>{
  const input=body(req),version=expectedRevision(req),current=await readData(req);
  if(!req.auth.scopes.includes('purge')&&(input.mode==='replace'||removalRequiresPurge(current.data,input.data)))throw httpError(403,'INSUFFICIENT_SCOPE','Permanent removal requires the purge scope.');
  const result=await commitWorkspace(pool,req.auth.userId,{expectedRevision:version,data:input.data,mode:input.mode||'edit',source:source(req),idempotencyKey:idempotencyKey(req)});res.set('ETag',`"${result.revision}"`).json(result);
 });
 router.get('/notes',read,async(req,res)=>{const {data,revision}=await readData(req);let items=visible(req,data.notes);if(req.query.tag)items=items.filter(n=>n.tags.includes(req.query.tag));if(req.query.kind)items=items.filter(n=>n.kind===req.query.kind);res.json({revision,...collection(req,items.map(n=>present('notes',n)))})});
 router.get('/notes/:id/references',read,async(req,res)=>{
  const {data,revision}=await readData(req);find(data.notes,req.params.id,'Note');const items=[];
  for(const map of data.maps){if(map.nodes.some(n=>n.noteId===req.params.id))items.push({mapId:map.id,name:map.name,deleted:map.deleted,kind:'draft',url:link('maps',map.id)});for(const saved of [...(map.history||[]),...(map.saved?[map.saved]:[])])if(saved.nodes.some(n=>n.noteId===req.params.id))items.push({mapId:map.id,name:map.name,deleted:map.deleted,kind:'revision',number:saved.number,url:link('maps',map.id)})}
  res.json({revision,...collection(req,items)});
 });
 router.get('/notes/:id/tags',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,...collection(req,find(data.notes,req.params.id,'Note').tags.map(name=>({name})))})});
 router.put('/notes/:id/tags',write,(req,res)=>mutate(req,res,'note.tags','note',req.params.id,data=>{const note=find(data.notes,req.params.id,'Note');ensureTags(data,body(req).tags);note.tags=body(req).tags;note.updatedAt=now();return note}));
 router.get('/notes/:id',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,item:present('notes',find(data.notes,req.params.id,'Note'))})});
 router.post('/notes',write,(req,res)=>mutate(req,res,'note.create','note',null,data=>{
  const input=body(req);const note={id:input.id||id('note'),summary:input.summary,body:input.body??'',tags:input.tags??[],kind:input.kind??'thought',createdAt:now(),updatedAt:now(),deleted:false};ensureTags(data,note.tags);data.notes.unshift(note);return note;
 },201));
 router.patch('/notes/:id',write,(req,res)=>mutate(req,res,'note.update','note',req.params.id,data=>{const note=find(data.notes,req.params.id,'Note');Object.assign(note,fields(body(req),['summary','body','tags','kind']),{updatedAt:now()});ensureTags(data,note.tags);return note}));
 router.delete('/notes/:id',write,(req,res)=>mutate(req,res,'note.trash','note',req.params.id,data=>{const note=find(data.notes,req.params.id,'Note');note.deleted=true;note.updatedAt=now();return note}));
 router.get('/tags/suggestions',read,async(req,res)=>{const {data,revision}=await readData(req);const items=data.tags.map(name=>({name,count:data.notes.filter(n=>!n.deleted&&n.tags.includes(name)).length})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));res.json({revision,...collection(req,items)})});
 router.get('/tags',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,...collection(req,data.tags.map(name=>({id:name,name,count:data.notes.filter(n=>!n.deleted&&n.tags.includes(name)).length})))})});
 router.get('/tags/:id',read,async(req,res)=>{const {data,revision}=await readData(req);if(!data.tags.includes(req.params.id))throw httpError(404,'NOT_FOUND','Tag not found.');res.json({revision,item:{id:req.params.id,name:req.params.id,noteIds:data.notes.filter(n=>n.tags.includes(req.params.id)).map(n=>n.id)}})});
 router.post('/tags',write,(req,res)=>mutate(req,res,'tag.create','tag',null,data=>{let {name}=body(req);if(typeof name!=='string')throw httpError(400,'INVALID_TAG','Use a nonempty tag name.');name=cleanTag(name);name=data.tags.find(t=>normalizeTag(t)===normalizeTag(name))||name;ensureTags(data,[name]);return{id:name,name}},201));
 router.patch('/tags/:id',write,(req,res)=>mutate(req,res,'tag.rename','tag',req.params.id,data=>{
  const old=req.params.id;let {name}=body(req);if(typeof name==='string')name=cleanTag(name);if(!data.tags.includes(old))throw httpError(404,'NOT_FOUND','Tag not found.');if(typeof name!=='string'||!name.trim()||name.length>100)throw httpError(400,'INVALID_TAG','Use a tag name of 1–100 characters.');if(data.tags.some(t=>t!==old&&normalizeTag(t)===normalizeTag(name)))throw httpError(409,'TAG_EXISTS','A matching tag already exists.');
  data.tags=data.tags.map(t=>t===old?name:t);for(const note of data.notes)note.tags=note.tags.map(t=>t===old?name:t);for(const map of data.maps)map.tagOrder=(map.tagOrder||[]).map(t=>t===old?name:t);return{id:name,name};
 }));
 router.delete('/tags/:id',write,(req,res)=>mutate(req,res,'tag.delete','tag',req.params.id,data=>{if(!data.tags.includes(req.params.id))throw httpError(404,'NOT_FOUND','Tag not found.');data.tags=data.tags.filter(t=>t!==req.params.id);for(const n of data.notes)n.tags=n.tags.filter(t=>t!==req.params.id);for(const m of data.maps)m.tagOrder=(m.tagOrder||[]).filter(t=>t!==req.params.id);return{ok:true}}));
 router.get('/maps',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,...collection(req,visible(req,data.maps).map(m=>present('maps',m)))})});
 router.get('/maps/:id',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,item:present('maps',findMap(data,req.params.id))})});
 router.post('/maps',write,(req,res)=>mutate(req,res,'map.create','map',null,data=>{
  const input=body(req);const map={id:input.id||id('map'),name:input.name??'Untitled board',summary:input.summary??'',description:input.description??'',tagOrder:[],updatedAt:now(),nodes:[],edges:[],saved:null,history:[],deleted:false};
  if(input.noteIds!==undefined){if(!Array.isArray(input.noteIds))throw httpError(400,'INVALID_NOTES','noteIds must be an array.');map.nodes=input.noteIds.map((noteId,i)=>({id:id('node'),type:'note',noteId,position:{x:80+(i%3)*300,y:70+Math.floor(i/3)*200}}))}data.maps.unshift(map);return map;
 },201));
 router.patch('/maps/:id',write,(req,res)=>mutate(req,res,'map.update','map',req.params.id,data=>{const map=findMap(data,req.params.id);Object.assign(map,fields(body(req),['name','summary','description']),{updatedAt:now()});return map}));
 router.delete('/maps/:id',write,(req,res)=>mutate(req,res,'map.trash','map',req.params.id,data=>{const map=findMap(data,req.params.id);map.deleted=true;map.updatedAt=now();return map}));
 for(const kind of ['nodes','edges']){
  const singular=kind==='nodes'?'node':'edge';
  router.get(`/maps/:mapId/${kind}`,read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,...collection(req,findMap(data,req.params.mapId)[kind])})});
  router.get(`/maps/:mapId/${kind}/:id`,read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,item:find(findMap(data,req.params.mapId)[kind],req.params.id,singular)})});
  router.post(`/maps/:mapId/${kind}`,write,(req,res)=>mutate(req,res,`${singular}.create`,singular,null,data=>{
   const map=findMap(data,req.params.mapId),input=body(req);const item={...fields(input,kind==='nodes'?['id','type','noteId','position','parentId','width','height','style','data','zIndex','extent','expandParent','color']:['id','source','target','label','sourceHandle','targetHandle','zIndex','route']),id:input.id||id(singular)};
   if(kind==='nodes'){item.type??='annotation';item.position??={x:0,y:0};if(item.parentId===null)delete item.parentId;if(['annotation','group'].includes(item.type))item.data??={label:item.type==='group'?'Untitled group':'New annotation'}}map[kind].push(item);map.updatedAt=now();return item;
  },201));
  router.patch(`/maps/:mapId/${kind}/:id`,write,(req,res)=>mutate(req,res,`${singular}.update`,singular,req.params.id,data=>{
   const map=findMap(data,req.params.mapId),item=find(map[kind],req.params.id,singular),input=body(req);const allowed=kind==='nodes'?['type','noteId','position','parentId','width','height','style','data','zIndex','extent','expandParent','color']:['source','target','label','sourceHandle','targetHandle','zIndex','route'];Object.assign(item,fields(input,allowed));if(item.parentId===null)delete item.parentId;if(kind==='nodes')pruneNoteOrder(map);map.updatedAt=now();return item;
  }));
  router.delete(`/maps/:mapId/${kind}/:id`,write,(req,res)=>mutate(req,res,`${singular}.remove`,singular,req.params.id,data=>{
   const map=findMap(data,req.params.mapId),item=find(map[kind],req.params.id,singular);
   if(kind==='nodes'){
    const world={...item.position};let parent=item.parentId;const visited=new Set();while(parent&&!visited.has(parent)){visited.add(parent);const p=map.nodes.find(n=>n.id===parent);if(!p)break;world.x+=p.position.x;world.y+=p.position.y;parent=p.parentId}
    for(const child of map.nodes.filter(n=>n.parentId===item.id)){delete child.parentId;child.position={x:child.position.x+world.x,y:child.position.y+world.y}}
    map.edges=map.edges.filter(e=>e.source!==item.id&&e.target!==item.id);
   }
   map[kind]=map[kind].filter(x=>x.id!==item.id);if(kind==='nodes')pruneNoteOrder(map);map.updatedAt=now();return{ok:true};
  }));
 }
 router.get('/maps/:id/tags',read,async(req,res)=>{const {data,revision}=await readData(req);const map=findMap(data,req.params.id);res.json({revision,tagOrder:map.tagOrder||[]})});
 router.put('/maps/:id/tags',write,(req,res)=>mutate(req,res,'map.tags','map',req.params.id,data=>{const map=findMap(data,req.params.id);map.tagOrder=body(req).tagOrder;map.updatedAt=now();return map}));
 router.put('/maps/:id/note-order',write,(req,res)=>mutate(req,res,'map.note_order','map',req.params.id,data=>{const map=findMap(data,req.params.id),order=body(req).noteIds;const references=[...new Set(map.nodes.filter(n=>n.type==='note').map(n=>n.noteId))];if(!Array.isArray(order)||order.length!==references.length||new Set(order).size!==order.length||order.some(v=>!references.includes(v)))throw httpError(400,'INVALID_ORDER','noteIds must include each source note in this map exactly once.');map.noteOrder=order;map.updatedAt=now();return map}));
 router.get('/maps/:mapId/revisions',read,async(req,res)=>{const {data,revision}=await readData(req),map=findMap(data,req.params.mapId);res.json({revision,...collection(req,[...(map.history||[]),...(map.saved?[map.saved]:[])])})});
 router.get('/maps/:mapId/revisions/:number',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,item:mapRevision(findMap(data,req.params.mapId),req.params.number)})});
 router.post('/maps/:mapId/revisions',write,(req,res)=>mutate(req,res,'revision.create','map',req.params.mapId,data=>{
  const map=findMap(data,req.params.mapId),input=body(req);const numbers=[...(map.history||[]),...(map.saved?[map.saved]:[])].map(r=>r.number);if(map.saved)map.history.push(map.saved);
  map.saved={number:Math.max(0,...numbers)+1,date:now(),name:map.name,summary:map.summary,description:map.description,nodes:clone(map.nodes),edges:clone(map.edges),notes:[],tagOrder:clone(map.tagOrder||[]),...(input.label!==undefined?{label:input.label}:{})};map.updatedAt=map.saved.date;return{number:map.saved.number};
 },201));
 router.patch('/maps/:mapId/revisions/:number',write,(req,res)=>mutate(req,res,'revision.label','map',req.params.mapId,data=>{const revision=mapRevision(findMap(data,req.params.mapId),req.params.number),label=body(req).label;if(typeof label!=='string'||label.length>160)throw httpError(400,'INVALID_LABEL','Use a revision label up to 160 characters.');revision.label=label;return{number:revision.number,label}}));
 router.delete('/maps/:mapId/revisions/:number',purge,(req,res)=>mutate(req,res,'revision.delete','map',req.params.mapId,data=>{
  const map=findMap(data,req.params.mapId),revision=mapRevision(map,req.params.number);map.history=(map.history||[]).filter(r=>r.number!==revision.number);if(map.saved?.number===revision.number){map.saved=map.history.pop()||null}return{ok:true};
 }));
 router.post('/maps/:mapId/revisions/:number/restore',write,(req,res)=>mutate(req,res,'revision.restore','map',req.params.mapId,data=>{const map=findMap(data,req.params.mapId),revision=mapRevision(map,req.params.number);Object.assign(map,clone(fields(revision,['name','summary','description','nodes','edges','tagOrder','noteOrder'])),{updatedAt:now()});if(revision.noteOrder===undefined)delete map.noteOrder;return map}));
 router.get('/trash',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,...collection(req,[...data.notes.filter(n=>n.deleted).map(n=>({...present('notes',n),objectType:'note'})),...data.maps.filter(m=>m.deleted).map(m=>({...present('maps',m),objectType:'map'}))])})});
 for(const kind of ['notes','maps']){
  router.post(`/trash/${kind}/:id/restore`,write,(req,res)=>mutate(req,res,`${kind}.restore`,kind,req.params.id,data=>{const item=find(data[kind],req.params.id,kind);item.deleted=false;item.updatedAt=now();return item}));
  const doPurge=(req,res)=>mutate(req,res,`${kind}.purge`,kind,req.params.id,data=>{const item=find(data[kind],req.params.id,kind);if(!item.deleted)throw httpError(409,'NOT_TRASHED','Move this item to Trash before permanently deleting it.');data[kind]=data[kind].filter(x=>x.id!==item.id);return{ok:true}});
  router.delete(`/trash/${kind}/:id`,purge,doPurge);router.post(`/trash/${kind}/:id/purge`,purge,doPurge);
 }
 router.get('/me/preferences',read,async(req,res)=>{const {data,revision}=await readData(req);res.json({revision,preferences:{theme:data.theme,motion:data.motion}})});
 const updatePreferences=(req,res)=>mutate(req,res,'preferences.update','workspace',null,data=>{Object.assign(data,fields(body(req),['theme','motion']));return{theme:data.theme,motion:data.motion}});
 router.patch('/me/preferences',write,updatePreferences);router.put('/me/preferences',write,updatePreferences);
 return router;
}
