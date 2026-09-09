import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const databaseUrl=process.env.TEST_DATABASE_URL;
test('granular objects preserve saved notes, enforce purge, and round-trip through real HTTP and stdio MCP clients',{skip:!databaseUrl},async t=>{
 const {createPool,migrate}=await import('../src/db.mjs');const {createApp}=await import('../src/app.mjs');
 const admin=createPool(databaseUrl),schema=`objects_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(databaseUrl);url.searchParams.set('options',`-c search_path=${schema}`);const pool=createPool(url.toString());await migrate(pool);
 const server=createServer();server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;server.on('request',createApp({pool,origin}));
 t.after(async()=>{await new Promise(r=>server.close(r));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()});
 let cookie='',revision=0;
 async function req(path,method='GET',body,extra={}){
  const response=await fetch(origin+'/api/v1'+path,{method,headers:{Cookie:cookie,Origin:origin,'X-Socrates-CSRF':'1','Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();return{status:response.status,value,cookie:response.headers.get('set-cookie')};
 }
 async function mutate(path,method,body={}){const r=await req(path,method,{expectedRevision:revision,...body});assert.ok(r.status<300,JSON.stringify(r.value));revision=r.value.revision;return r.value}
 const setup=await req('/auth/setup','POST',{email:'objects@example.com',password:'objects-secret-password'});assert.equal(setup.status,201);cookie=setup.cookie.split(';')[0];
 const tag=(await mutate('/tags','POST',{name:' #Reflection '})).result;assert.equal(tag.name,'Reflection');assert.equal((await req('/tags/'+encodeURIComponent(tag.id))).status,200);
 const one=(await mutate('/notes','POST',{summary:'双语 note',body:'Original body 中文',tags:['Learning']})).result;
 const two=(await mutate('/notes','POST',{summary:'Second note',body:'Second',tags:[]})).result;
 const map=(await mutate('/maps','POST',{name:'Saved board',noteIds:[one.id,two.id]})).result;
 const group=(await mutate(`/maps/${map.id}/nodes`,'POST',{type:'group',position:{x:40,y:60},data:{label:'Group'},style:{width:300,height:250}})).result;
 await mutate(`/maps/${map.id}/nodes/${map.nodes[0].id}`,'PATCH',{parentId:group.id,position:{x:10,y:20}});
 const shape=(await mutate(`/maps/${map.id}/nodes`,'POST',{type:'shape',position:{x:5,y:5},data:{shape:'ellipse',label:'Region',color:'sage',strokeStyle:'dashed'},style:{width:100,height:90},zIndex:-10})).result;
 const edge=(await mutate(`/maps/${map.id}/edges`,'POST',{source:map.nodes[0].id,target:map.nodes[1].id,label:'启发',route:[{x:10,y:20}]})).result;
 const invalid=await req(`/maps/${map.id}/nodes/${shape.id}`,'PATCH',{expectedRevision:revision,style:{width:-1,height:10}});assert.equal(invalid.status,400);assert.equal((await req('/workspace')).value.revision,revision);
 assert.equal((await req('/notes?limit=201')).status,400);
 assert.equal((await req('/notes','POST',{summary:'Missing revision',body:''})).status,428);
 assert.equal((await req('/notes','POST',{expectedRevision:revision,summary:'Wrong origin'},{Origin:'https://attacker.example'})).status,403);
 await mutate(`/maps/${map.id}/note-order`,'PUT',{noteIds:[two.id,one.id]});
 await mutate(`/maps/${map.id}/revisions`,'POST',{label:'v1'});
 const saved=(await req(`/maps/${map.id}/revisions/1`)).value.item;assert.equal(saved.notes.find(n=>n.id===one.id).body,'Original body 中文');assert.deepEqual(saved.noteOrder,[two.id,one.id]);
 await mutate(`/notes/${one.id}`,'PATCH',{body:'Changed live body'});
 assert.deepEqual((await req(`/maps/${map.id}/revisions/1`)).value.item,saved);
 for(const scopes of [['write'],['purge'],['read','purge']])assert.equal((await req('/connections','POST',{name:'Invalid hierarchy',scopes})).status,400);
 const writer=(await req('/connections','POST',{name:'MCP writer',scopes:['read','write']})).value;
 const snapshot=(await req('/workspace')).value;const tampered=structuredClone(snapshot.data);tampered.maps[0].saved.notes[0].body='Tampered historical body';
 assert.equal((await req('/workspace','PUT',{expectedRevision:revision,data:tampered})).status,409);
 assert.equal((await req('/workspace','PUT',{expectedRevision:revision,data:tampered,mode:'replace'},{Authorization:`Bearer ${writer.token}`})).status,403);
 assert.deepEqual((await req(`/maps/${map.id}/revisions/1`)).value.item,saved);
 await mutate(`/maps/${map.id}/revisions/1`,'PATCH',{label:'Important'});
 await mutate(`/notes/${one.id}`,'DELETE');assert.equal((await req(`/trash/notes/${one.id}`,'DELETE',{expectedRevision:revision})).status,409);
 await mutate(`/trash/notes/${one.id}/restore`,'POST');
 await mutate(`/maps/${map.id}/nodes/${group.id}`,'DELETE');const ungrouped=(await req(`/maps/${map.id}/nodes/${map.nodes[0].id}`)).value.item;assert.deepEqual(ungrouped.position,{x:50,y:80});assert.equal(ungrouped.parentId,undefined);
 await mutate(`/maps/${map.id}/edges/${edge.id}`,'DELETE');
 await mutate(`/tags/Learning`,'PATCH',{name:'学习'});assert.deepEqual((await req(`/notes/${one.id}`)).value.item.tags,['学习']);
 const third=(await mutate('/notes','POST',{summary:'Third source',body:'',tags:[]})).result;await mutate(`/maps/${map.id}/nodes`,'POST',{type:'note',noteId:third.id,position:{x:0,y:0}});await mutate(`/maps/${map.id}/note-order`,'PUT',{noteIds:[third.id,one.id,two.id]});
 await mutate(`/maps/${map.id}/revisions/1/restore`,'POST');assert.deepEqual((await req(`/maps/${map.id}`)).value.item.noteOrder,[two.id,one.id]);assert.equal((await req(`/maps/${map.id}/edges`)).value.items.length,1);
 const unordered=(await mutate('/maps','POST',{name:'No saved order',noteIds:[third.id]})).result;await mutate(`/maps/${unordered.id}/revisions`,'POST');await mutate(`/maps/${unordered.id}/note-order`,'PUT',{noteIds:[third.id]});await mutate(`/maps/${unordered.id}/revisions/1/restore`,'POST');assert.equal((await req(`/maps/${unordered.id}`)).value.item.noteOrder,undefined);
 const httpClient=new Client({name:'http-test',version:'1.0.0'});await httpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${writer.token}`}}}));
 try{
  const tools=await httpClient.listTools();assert.ok(tools.tools.length>=45);
  const result=await httpClient.callTool({name:'notes_create',arguments:{expectedRevision:revision,summary:'From HTTP MCP',body:'真实 API write',tags:[],idempotencyKey:'mcp-test'}});assert.notEqual(result.isError,true,JSON.stringify(result));const written=JSON.parse(result.content[0].text);assert.equal(written.data,undefined);revision=written.revision;
  assert.equal((await req(`/notes/${written.result.id}`)).value.item.summary,'From HTTP MCP');
  const conflict=await httpClient.callTool({name:'notes_create',arguments:{expectedRevision:0,summary:'Conflict'}});assert.equal(conflict.isError,true);assert.equal(JSON.parse(conflict.content[0].text).error.code,'VERSION_CONFLICT');
 }finally{await httpClient.close()}
 const stdio=new Client({name:'stdio-test',version:'1.0.0'});await stdio.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/mcp-stdio.mjs',import.meta.url))],env:{...process.env,SOCRATES_API_URL:origin,SOCRATES_API_TOKEN:writer.token},stderr:'pipe'}));
 try{const metadata=await stdio.callTool({name:'workspace_get',arguments:{}});const compact=JSON.parse(metadata.content[0].text);assert.equal(compact.data,undefined);assert.equal(compact.revision,revision);assert.ok(compact.counts.notes>=3);const full=await stdio.callTool({name:'workspace_get',arguments:{includeData:true}});assert.ok(JSON.parse(full.content[0].text).data.notes.length>=3);const result=await stdio.callTool({name:'notes_list',arguments:{q:'HTTP MCP'}});assert.notEqual(result.isError,true);assert.equal(JSON.parse(result.content[0].text).items.length,1);assert.equal(JSON.parse(result.content[0].text).items[0].body,undefined)}finally{await stdio.close()}
 await mutate(`/maps/${map.id}/nodes/${map.nodes[0].id}`,'DELETE');assert.deepEqual((await req(`/maps/${map.id}`)).value.item.noteOrder,[two.id]);assert.equal((await req(`/maps/${map.id}/edges`)).value.items.length,0);assert.equal((await req(`/notes/${one.id}`)).status,200);
 assert.ok((await req('/activity')).value.items.some(e=>e.source==='mcp'));
 await req(`/connections/${writer.connection.id}`,'DELETE');const revoked=await fetch(origin+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${writer.token}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(revoked.status,401);
 await mutate(`/maps/${map.id}`,'DELETE');await mutate(`/trash/maps/${map.id}`,'DELETE');assert.equal((await req(`/notes/${one.id}`)).status,200);
 await mutate(`/notes/${one.id}`,'DELETE');await mutate(`/trash/notes/${one.id}`,'DELETE');assert.equal((await req(`/notes/${one.id}`)).status,404);
});
