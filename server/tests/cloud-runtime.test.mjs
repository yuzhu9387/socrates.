import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../src/app.mjs';
import {hashSecret} from '../src/auth.mjs';

async function serve(t,options) {
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 server.on('request',createApp({pool:{query(){throw new Error('Unexpected database access')}},origin,...options(origin)}));
 return origin;
}

test('untrusted forwarded addresses cannot escape the default sign-in rate limit',async t=>{
 const origin=await serve(t,()=>({}));
 const attempt=forwarded=>fetch(`${origin}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Socrates-CSRF':'1',...(forwarded?{'X-Forwarded-For':forwarded}:{})},body:'{}'});
 for(let i=0;i<30;i++)assert.equal((await attempt()).status,400);
 assert.equal((await attempt('203.0.113.10')).status,429);
 assert.equal((await attempt('203.0.113.20')).status,429);
});

test('configured proxy hops separate visitors without trusting a spoofed leftmost address',async t=>{
 const origin=await serve(t,()=>({trustProxyHops:1}));
 const attempt=forwarded=>fetch(`${origin}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Socrates-CSRF':'1','X-Forwarded-For':forwarded},body:'{}'});
 for(let i=0;i<30;i++)assert.equal((await attempt('203.0.113.10')).status,400);
 assert.equal((await attempt('203.0.113.10')).status,429);
 assert.equal((await attempt('198.51.100.99, 203.0.113.10')).status,429);
 assert.equal((await attempt('203.0.113.20')).status,400);
});

test('proxy configuration rejects permissive booleans, negative and noninteger hop counts',()=>{
 for(const trustProxyHops of [true,false,'1',-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>createApp({pool:{},trustProxyHops}),/proxy.*hop/i);
 }
});

const token='sct_'+('a'.repeat(43));
const invalidScopeToken='sct_'+('b'.repeat(43));
const owner='5a4530a4-c32b-41be-ab90-932bf0468c9b';
const activity={id:'bf3e580c-e922-4b12-87f3-83a1ae497c92',source:'ui',action:'note.create',objectType:'note',objectId:'note-1',createdAt:'2026-09-09T00:00:00.000Z'};
function authAndActivityPool(){
 return {async query(sql,args){
  if(sql.startsWith('SELECT c.id,c.user_id,c.scopes')){
   if(![hashSecret(token),hashSecret(invalidScopeToken)].includes(args[0]))return{rows:[]};
   return{rows:[{id:'be42aec2-204a-4dd1-975d-2b2319e294ef',user_id:owner,email:'owner@example.test',scopes:args[0]===hashSecret(token)?['read']:['write']}]};
  }
  if(sql.startsWith('UPDATE api_connections SET last_used_at'))return{rows:[],rowCount:1};
  if(sql.startsWith('SELECT s.user_id,u.email'))return{rows:[{user_id:owner,email:'owner@example.test'}]};
  if(sql.includes('FROM activity_events WHERE owner_id=$1')){
   assert.equal(args[0],owner);
   return{rows:sql.startsWith('SELECT count(*)')?[{count:'1'}]:[activity]};
  }
  throw new Error(`Unexpected database query: ${sql}`);
 }};
}

test('HTTP MCP permits the public HTTPS origin, uses its loopback upstream, and retains auth and scopes',async t=>{
 const publicOrigin='https://socrates.example.test';
 const realFetch=globalThis.fetch;
 // The external IAM boundary is unavailable locally; it rejects application tokens.
 t.mock.method(globalThis,'fetch',(url,options)=>new URL(url).origin===publicOrigin
  ?Promise.resolve(new Response(JSON.stringify({error:{code:'CLOUD_IAM_REQUIRED'}}),{status:403,headers:{'Content-Type':'application/json'}}))
  :realFetch(url,options));
 const origin=await serve(t,loopback=>({pool:authAndActivityPool(),origin:publicOrigin,mcpApiUrl:loopback}));
 const client=new Client({name:'cloud-runtime-test',version:'1.0.0'});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`,Origin:publicOrigin}}}));
 const result=await client.callTool({name:'activity_list',arguments:{}});
 assert.equal(result.isError,undefined);
 assert.deepEqual(result.structuredContent,{items:[activity],total:1,limit:50,offset:0});
 const write=await client.callTool({name:'notes_create',arguments:{expectedRevision:0,summary:'Must not write'}});
 assert.equal(write.isError,true);
 assert.equal(write.structuredContent.error.code,'INSUFFICIENT_SCOPE');
 const purge=await client.callTool({name:'activity_clear',arguments:{}});
 assert.equal(purge.isError,true);
 assert.equal(purge.structuredContent.error.code,'INSUFFICIENT_SCOPE');
 for(const [headers,status,code] of [
  [{Authorization:`Bearer ${token}`,Origin:'https://alien.example.test'},403,'ORIGIN_DENIED'],
  [{Origin:publicOrigin},401,'UNAUTHORIZED'],
  [{Authorization:`Bearer ${invalidScopeToken}`,Origin:publicOrigin},401,'UNAUTHORIZED'],
  [{Cookie:`socrates_session=${'c'.repeat(43)}`,Origin:publicOrigin},403,'TOKEN_REQUIRED'],
 ]){
  const response=await fetch(`${origin}/mcp`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,status);
  assert.equal((await response.json()).error.code,code);
 }
});

test('createApp keeps its public origin as the MCP upstream when no override is supplied',async t=>{
 const origin=await serve(t,()=>({pool:authAndActivityPool()}));
 const client=new Client({name:'default-runtime-test',version:'1.0.0'});
 t.after(()=>client.close());
 await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`,Origin:origin}}}));
 const result=await client.callTool({name:'activity_list',arguments:{}});
 assert.equal(result.isError,undefined);
 assert.equal(result.structuredContent.items[0].id,activity.id);
});
