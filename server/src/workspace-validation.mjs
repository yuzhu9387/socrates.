import { isDeepStrictEqual } from 'node:util';

export const emptyWorkspace = () => ({version:1,notes:[],tags:[],maps:[],theme:'light',motion:true});
export function workspaceError(status, code, message, extras = {}) { return Object.assign(new Error(message), {status,code,...extras}); }
const invalid = (path, message) => { throw workspaceError(400,'VALIDATION_ERROR',`${path}: ${message}`,{details:{path}}); };
const object = (v,p) => { if(!v || typeof v!=='object' || Array.isArray(v)) invalid(p,'must be an object'); };
const keys = (v, allowed, p) => { object(v,p); for(const k of Object.keys(v)) if(!allowed.includes(k)) invalid(`${p}.${k}`,'unknown field'); };
const text = (v,p,max=1000000,nonempty=false) => { if(typeof v!=='string'||v.length>max||v.includes('\0')||(nonempty&&!v.trim())) invalid(p,`must be ${nonempty?'nonempty ':''}text of at most ${max} characters without null bytes`); };
const bool = (v,p) => {if(typeof v!=='boolean') invalid(p,'must be boolean');};
const finite = (v,p,min=-100000000,max=100000000) => { if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max) invalid(p,`must be finite, between ${min} and ${max}`); };
const optional = (v,k,fn,p) => { if(v[k]!==undefined) fn(v[k],`${p}.${k}`); };
const array = (v,p,max=10000) => {if(!Array.isArray(v)||v.length>max) invalid(p,`must be an array of at most ${max} items`);};
const id = (v,p) => { text(v,p,200,true); if(/[\u0000-\u001f\u007f]/u.test(v)) invalid(p,'must not contain control characters'); };
const date = (v,p) => {text(v,p,64,true);if(!Number.isFinite(Date.parse(v))) invalid(p,'invalid timestamp');};
const segmenter = new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const tagKey = t => t.trim().replace(/^#+/u,'').trim().normalize('NFKC').toLowerCase();
const tagText = (t,p) => {text(t,p,160,true);if(!tagKey(t))invalid(p,'empty tag');};
const colors = ['paper','sage','sand','clay','slate','lilac'];
const color = (v,p) => { if(!colors.includes(v)) invalid(p,'unknown palette color'); };
const coordinate = (v,p) => {keys(v,['x','y'],p);finite(v.x,`${p}.x`);finite(v.y,`${p}.y`);};
const unique = (items,p,key='id') => {const result=new Map();for(const [i,item] of items.entries()){object(item,`${p}[${i}]`);id(item[key],`${p}[${i}].${key}`);if(result.has(item[key]))invalid(p,`duplicate ${key}`);result.set(item[key],item);}return result;};
const tagList = (v,p) => {array(v,p,1000);v.forEach((t,i)=>tagText(t,`${p}[${i}]`));};
function note(v,p,{legacy=false,existingNotes=new Map()}={}){
 keys(v,['id','summary','body','tags','kind','createdAt','updatedAt','deleted'],p);id(v.id,`${p}.id`);text(v.summary,`${p}.summary`,10000,true);
 if(!legacy && existingNotes.get(v.id)?.summary!==v.summary && [...segmenter.segment(v.summary)].length>160) invalid(`${p}.summary`,'must contain at most 160 graphemes');
 text(v.body,`${p}.body`,4000000);tagList(v.tags,`${p}.tags`);date(v.createdAt,`${p}.createdAt`);date(v.updatedAt,`${p}.updatedAt`);
 optional(v,'deleted',bool,p);if(v.deleted===undefined)v.deleted=false;
 optional(v,'kind',(v,p)=>{if(!['story','thought'].includes(v))invalid(p,'must be story or thought');},p);
}
function structure(v,notes,p){
 text(v.name,`${p}.name`,500,true);text(v.summary,`${p}.summary`,10000);text(v.description,`${p}.description`,1000000);
 array(v.nodes,`${p}.nodes`);array(v.edges,`${p}.edges`,20000);const nodes=unique(v.nodes,`${p}.nodes`);unique(v.edges,`${p}.edges`);
 v.nodes.forEach((n,i)=>{
  const path=`${p}.nodes[${i}]`;keys(n,['id','type','noteId','position','parentId','style','data','color','zIndex','width','height','extent','expandParent'],path);
  if(!['note','group','annotation','shape'].includes(n.type))invalid(`${path}.type`,'unknown node type');coordinate(n.position,`${path}.position`);
  if(n.type==='note'){id(n.noteId,`${path}.noteId`);if(!notes.has(n.noteId))invalid(`${path}.noteId`,'missing source note');}else if(n.noteId!==undefined)invalid(`${path}.noteId`,'only note nodes may reference notes');
  optional(n,'color',color,path);optional(n,'zIndex',finite,path);for(const k of ['width','height'])optional(n,k,(v,p)=>finite(v,p,0.01),path);
  if(n.style!==undefined){keys(n.style,['width','height'],`${path}.style`);for(const k of Object.keys(n.style))finite(n.style[k],`${path}.style.${k}`,0.01);}
  if(n.data!==undefined){keys(n.data,['label','shape','color','strokeStyle'],`${path}.data`);optional(n.data,'label',(v,p)=>text(v,p,100000),`${path}.data`);optional(n.data,'color',color,`${path}.data`);if(n.data.strokeStyle!==undefined&&!['solid','dashed'].includes(n.data.strokeStyle))invalid(`${path}.data.strokeStyle`,'invalid outline');if(n.data.shape!==undefined&&!['rectangle','ellipse'].includes(n.data.shape))invalid(`${path}.data.shape`,'invalid shape');}
  if(n.type==='shape'&&(!n.style?.width||!n.style?.height||!['rectangle','ellipse'].includes(n.data?.shape)||typeof n.data?.label!=='string'))invalid(path,'shape requires dimensions, shape and label');
  if(['annotation','group'].includes(n.type)&&typeof n.data?.label!=='string')invalid(path,'group and annotation require text label');
  if(n.parentId!==undefined){id(n.parentId,`${path}.parentId`);const parent=nodes.get(n.parentId);if(!parent||parent.type!=='group'||parent.id===n.id)invalid(`${path}.parentId`,'parent must be another group in this map');}
  optional(n,'expandParent',bool,path);if(n.extent!==undefined&&n.extent!=='parent')invalid(`${path}.extent`,'only parent extent is supported');
 });
 const complete=new Set();for(const n of v.nodes){let curr=n;const visiting=new Set();while(curr&&!complete.has(curr.id)){if(visiting.has(curr.id))invalid(`${p}.nodes`,'cyclic parent references');visiting.add(curr.id);curr=nodes.get(curr.parentId);}for(const key of visiting)complete.add(key);}
 v.edges.forEach((e,i)=>{const path=`${p}.edges[${i}]`;keys(e,['id','source','target','label','route','zIndex','sourceHandle','targetHandle'],path);id(e.source,`${path}.source`);id(e.target,`${path}.target`);if(nodes.get(e.source)?.type!=='note'||nodes.get(e.target)?.type!=='note')invalid(path,'edges must connect note nodes in this map');optional(e,'label',(v,p)=>text(v,p,10000),path);optional(e,'zIndex',finite,path);for(const k of ['sourceHandle','targetHandle'])optional(e,k,id,path);if(e.route!==undefined){array(e.route,`${path}.route`,64);e.route.forEach((a,i)=>coordinate(a,`${path}.route[${i}]`));}});
 if(v.tagOrder===undefined)v.tagOrder=[];tagList(v.tagOrder,`${p}.tagOrder`);
}
function revision(v,sourceNotes,p){
 keys(v,['number','date','name','summary','description','nodes','edges','notes','tagOrder','label','noteOrder'],p);
 if(!Number.isSafeInteger(v.number)||v.number<1)invalid(`${p}.number`,'must be a positive integer');date(v.date,`${p}.date`);optional(v,'label',(v,p)=>text(v,p,500),p);
 array(v.notes,`${p}.notes`);const frozen=unique(v.notes,`${p}.notes`);v.notes.forEach((n,i)=>{note(n,`${p}.notes[${i}]`,{legacy:true});if(!sourceNotes.has(n.id))invalid(`${p}.notes[${i}].id`,'missing historical source note');});structure(v,frozen,p);
 const referenced=new Set(v.nodes.filter(n=>n.type==='note').map(n=>n.noteId));if(referenced.size!==frozen.size||[...frozen.keys()].some(id=>!referenced.has(id)))invalid(`${p}.notes`,'saved notes must exactly match note node references');
 if(v.noteOrder!==undefined){array(v.noteOrder,`${p}.noteOrder`);const seen=new Set();v.noteOrder.forEach((n,i)=>{id(n,`${p}.noteOrder[${i}]`);if(!frozen.has(n)||seen.has(n))invalid(`${p}.noteOrder`,'invalid or duplicate note reference');seen.add(n);});}
}
export function validateWorkspace(input,options={}){
 // Check before JSON serialization so NaN/Infinity and unsafe keys cannot disappear.
 const scan=(v,p,depth=0)=>{if(depth>40)invalid(p,'too deeply nested');if(typeof v==='number'&&!Number.isFinite(v))invalid(p,'non-finite number');if(v&&typeof v==='object')for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k))invalid(p,'unsafe object key');scan(v[k],`${p}.${k}`,depth+1);}};scan(input,'workspace');
 let data;try{data=structuredClone(input);}catch{invalid('workspace','must contain serializable data');}
 keys(data,['version','notes','tags','maps','theme','motion'],'workspace');if(data.version!==1)invalid('workspace.version','must be 1');
 array(data.notes,'notes');array(data.maps,'maps',2000);tagList(data.tags,'tags');const notes=unique(data.notes,'notes');unique(data.maps,'maps');
 data.notes.forEach((n,i)=>note(n,`notes[${i}]`,options));if(!['light','dark','system'].includes(data.theme))invalid('theme','must be light, dark or system');bool(data.motion,'motion');
 const spellings=new Map();const canonical=t=>{const key=tagKey(t);if(!spellings.has(key))spellings.set(key,t.trim().replace(/^#+/u,'').trim());return spellings.get(key);};
 const normalize=list=>[...new Set(list.map(canonical))];data.tags=normalize(data.tags);data.notes.forEach(n=>n.tags=normalize(n.tags));
 data.maps.forEach((m,i)=>{const p=`maps[${i}]`;keys(m,['id','name','summary','description','updatedAt','createdAt','nodes','edges','saved','history','deleted','tagOrder','noteOrder'],p);date(m.updatedAt,`${p}.updatedAt`);optional(m,'createdAt',date,p);optional(m,'deleted',bool,p);if(m.deleted===undefined)m.deleted=false;structure(m,notes,p);m.tagOrder=normalize(m.tagOrder);if(m.history===undefined)m.history=[];array(m.history,`${p}.history`,2000);if(m.saved===undefined)m.saved=null;
  const numbers=new Set();[...m.history,...(m.saved?[m.saved]:[])].forEach((r,j)=>{revision(r,notes,`${p}.revisions[${j}]`);if(numbers.has(r.number))invalid(p,'duplicate revision number');numbers.add(r.number);});
  if(m.noteOrder!==undefined){array(m.noteOrder,`${p}.noteOrder`);const refs=new Set(m.nodes.filter(n=>n.type==='note').map(n=>n.noteId)),seen=new Set();for(const n of m.noteOrder){id(n,`${p}.noteOrder`);if(!refs.has(n)||seen.has(n))invalid(`${p}.noteOrder`,'invalid or duplicate note reference');seen.add(n);}}
 });data.tags=[...spellings.values()];return data;
}
export const sameValue = isDeepStrictEqual;
