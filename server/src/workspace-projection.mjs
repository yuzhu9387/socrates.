import {emptyWorkspace,workspaceError,tagKey} from './workspace-validation.mjs';

const iso = v => v instanceof Date ? v.toISOString() : v;
export async function projectWorkspace(client,ownerId,workspaceRow) {
 const row=workspaceRow||(await client.query('SELECT revision,preferences_json FROM workspaces WHERE owner_id=$1',[ownerId])).rows[0];
 if(!row)throw workspaceError(404,'WORKSPACE_NOT_FOUND','Workspace not found.');
 const data={...emptyWorkspace(),...row.preferences_json};
 const queries=[
  ['notes','SELECT * FROM notes WHERE owner_id=$1 ORDER BY sort_order,id'],
  ['tags','SELECT * FROM tags WHERE owner_id=$1 ORDER BY sort_order,normalized_name'],
  ['noteTags','SELECT * FROM note_tags WHERE owner_id=$1 ORDER BY sort_order'],
  ['maps','SELECT * FROM knowledge_maps WHERE owner_id=$1 ORDER BY sort_order,id'],
  ['nodes','SELECT * FROM canvas_nodes WHERE owner_id=$1 ORDER BY sort_order,id'],
  ['edges','SELECT * FROM canvas_edges WHERE owner_id=$1 ORDER BY sort_order,id'],
  ['mapTags','SELECT * FROM map_tag_settings WHERE owner_id=$1 ORDER BY sort_order'],
  ['revisions','SELECT * FROM map_revisions WHERE owner_id=$1 ORDER BY sort_order,number'],
  ['frozen','SELECT * FROM map_revision_notes WHERE owner_id=$1 ORDER BY sort_order']
 ];
 // One client/transaction preserves a consistent projection across every table.
 const tables={};for(const [name,sql] of queries)tables[name]=(await client.query(sql,[ownerId])).rows;
 const tags=new Map(tables.tags.map(t=>[t.normalized_name,t.name]));data.tags=tables.tags.map(t=>t.name);
 data.notes=tables.notes.map(n=>({id:n.id,summary:n.summary,body:n.body,tags:[],...(n.kind?{kind:n.kind}:{}),createdAt:iso(n.created_at),updatedAt:iso(n.updated_at),deleted:n.deleted}));
 const notes=new Map(data.notes.map(n=>[n.id,n]));for(const t of tables.noteTags)notes.get(t.note_id).tags.push(tags.get(t.tag_name));
 data.maps=tables.maps.map(m=>({id:m.id,name:m.name,summary:m.summary,description:m.description,updatedAt:iso(m.updated_at),...(m.created_at?{createdAt:iso(m.created_at)}:{}),deleted:m.deleted,...m.preferences_json,tagOrder:[],nodes:[],edges:[],saved:null,history:[]}));
 const maps=new Map(data.maps.map(m=>[m.id,m]));
 for(const n of tables.nodes)maps.get(n.map_id).nodes.push({id:n.id,type:n.kind,...(n.note_id?{noteId:n.note_id}:{}),...(n.parent_id?{parentId:n.parent_id}:{}),position:{x:n.x,y:n.y},...n.rendering_json});
 for(const e of tables.edges)maps.get(e.map_id).edges.push({id:e.id,source:e.source_id,target:e.target_id,...e.rendering_json});
 for(const t of tables.mapTags)maps.get(t.map_id).tagOrder.push(tags.get(t.tag_name));
 const revisions=new Map();for(const r of tables.revisions){const value={...r.structure_json,number:Number(r.number),...(r.label!==null?{label:r.label}:{}),notes:[]};revisions.set(JSON.stringify([r.map_id,r.number]),value);}
 for(const n of tables.frozen)revisions.get(JSON.stringify([n.map_id,n.revision_number])).notes.push(n.frozen_json);
 const selected=new Map(tables.maps.map(m=>[m.id,m.saved_revision_number]));for(const r of tables.revisions){const map=maps.get(r.map_id),value=revisions.get(JSON.stringify([r.map_id,r.number]));if(r.number===selected.get(r.map_id))map.saved=value;else map.history.push(value);}
 const revision=Number(row.revision);if(!Number.isSafeInteger(revision))throw workspaceError(500,'REVISION_OVERFLOW','Workspace revision is outside the supported range.');
 return {revision,data};
}

// Names and columns here are code constants, never request-controlled SQL fragments.
async function insertRows(client,table,columns,rows,conflict='') {
 for(let start=0;start<rows.length;start+=300){const batch=rows.slice(start,start+300),values=[];const placeholders=batch.map(row=>`(${row.map(value=>{values.push(value);return `$${values.length}`;}).join(',')})`);await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')} ${conflict}`,values);}
}
const rest=(value,exclude)=>Object.fromEntries(Object.entries(value).filter(([k])=>!exclude.includes(k)));
const upsert=(keys,columns)=>`ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${columns.filter(k=>!keys.includes(k)).map(k=>`${k}=EXCLUDED.${k}`).join(',')}`;
const allRevisions=m=>[...(m.history||[]),...(m.saved?[m.saved]:[])];
export async function persistWorkspace(client,ownerId,data,{replace=false}={}) {
 if(replace)await client.query('DELETE FROM map_revisions WHERE owner_id=$1',[ownerId]);
 const noteCols=['owner_id','id','summary','body','kind','created_at','updated_at','deleted','sort_order'];
 await insertRows(client,'notes',noteCols,data.notes.map((n,i)=>[ownerId,n.id,n.summary,n.body,n.kind??null,n.createdAt,n.updatedAt,n.deleted,i]),upsert(['owner_id','id'],noteCols));
 // Relations are replaced atomically while immutable revision bodies stay in place.
 for(const table of ['canvas_edges','canvas_nodes','map_tag_settings','note_tags'])await client.query(`DELETE FROM ${table} WHERE owner_id=$1`,[ownerId]);
 await client.query('DELETE FROM tags WHERE owner_id=$1',[ownerId]);
 await insertRows(client,'tags',['owner_id','normalized_name','name','sort_order'],data.tags.map((t,i)=>[ownerId,tagKey(t),t,i]));
 await insertRows(client,'note_tags',['owner_id','note_id','tag_name','sort_order'],data.notes.flatMap(n=>n.tags.map((t,i)=>[ownerId,n.id,tagKey(t),i])));
 const mapCols=['owner_id','id','name','summary','description','updated_at','created_at','deleted','saved_revision_number','sort_order','preferences_json'];
 await insertRows(client,'knowledge_maps',mapCols,data.maps.map((m,i)=>[ownerId,m.id,m.name,m.summary,m.description,m.updatedAt,m.createdAt??null,m.deleted,m.saved?.number??null,i,JSON.stringify(m.noteOrder?{noteOrder:m.noteOrder}:{})]),upsert(['owner_id','id'],mapCols));
 await client.query('DELETE FROM knowledge_maps WHERE owner_id=$1 AND NOT (id=ANY($2::text[]))',[ownerId,data.maps.map(m=>m.id)]);
 await insertRows(client,'canvas_nodes',['owner_id','map_id','id','kind','note_id','parent_id','x','y','rendering_json','sort_order'],data.maps.flatMap(m=>m.nodes.map((n,i)=>[ownerId,m.id,n.id,n.type,n.noteId??null,n.parentId??null,n.position.x,n.position.y,JSON.stringify(rest(n,['id','type','noteId','parentId','position'])),i])));
 await insertRows(client,'canvas_edges',['owner_id','map_id','id','source_id','target_id','rendering_json','sort_order'],data.maps.flatMap(m=>m.edges.map((e,i)=>[ownerId,m.id,e.id,e.source,e.target,JSON.stringify(rest(e,['id','source','target'])),i])));
 await insertRows(client,'map_tag_settings',['owner_id','map_id','tag_name','sort_order'],data.maps.flatMap(m=>m.tagOrder.map((t,i)=>[ownerId,m.id,tagKey(t),i])));
 for(const m of data.maps){
  const revs=allRevisions(m);
  await client.query('DELETE FROM map_revisions WHERE owner_id=$1 AND map_id=$2 AND NOT(number=ANY($3::bigint[]))',[ownerId,m.id,revs.map(r=>r.number)]);
  await insertRows(client,'map_revisions',['owner_id','map_id','number','label','structure_json','sort_order'],revs.map((r,i)=>[ownerId,m.id,r.number,r.label??null,JSON.stringify(rest(r,['number','label','notes'])),i]),'ON CONFLICT(owner_id,map_id,number) DO UPDATE SET label=EXCLUDED.label,sort_order=EXCLUDED.sort_order');
  await insertRows(client,'map_revision_notes',['owner_id','map_id','revision_number','note_id','frozen_json','sort_order'],revs.flatMap(r=>r.notes.map((n,i)=>[ownerId,m.id,r.number,n.id,JSON.stringify(n),i])),'ON CONFLICT(owner_id,map_id,revision_number,note_id) DO NOTHING');
 }
 await client.query('DELETE FROM notes WHERE owner_id=$1 AND NOT(id=ANY($2::text[]))',[ownerId,data.notes.map(n=>n.id)]);
 await client.query('UPDATE workspaces SET revision=revision+1,preferences_json=$2 WHERE owner_id=$1',[ownerId,JSON.stringify({theme:data.theme,motion:data.motion})]);
}
