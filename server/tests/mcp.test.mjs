import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
test('MCP exposes typed fixed-destination tools and returns real API errors',async t=>{
 const {createMcpServer}=await import('../src/mcp-server.mjs');
 assert.throws(()=>createMcpServer({apiUrl:'https://example.com',token:'invalid'}),/token/);
 const server=createMcpServer({apiUrl:'http://127.0.0.1:1',token:'sct_'+('a'.repeat(43))});
 const client=new Client({name:'contract-test',version:'1.0.0'}),[a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);t.after(async()=>{await client.close();await server.close()});
 const {tools}=await client.listTools();assert.ok(tools.some(x=>x.name==='notes_create'));assert.ok(tools.some(x=>x.name==='revisions_restore'));assert.ok(tools.length>=35);
 const create=tools.find(x=>x.name==='notes_create');assert.ok(create.inputSchema.required.includes('expectedRevision'));assert.equal(create.inputSchema.properties.url,undefined);assert.equal(tools.find(x=>x.name==='workspace_get').inputSchema.properties.includeData.default,false);
 const invalid=await client.callTool({name:'notes_create',arguments:{summary:'missing revision'}});assert.equal(invalid.isError,true);
 const unreachable=await client.callTool({name:'workspace_get',arguments:{}});assert.equal(unreachable.isError,true);assert.match(unreachable.content[0].text,/API_UNREACHABLE/);
});
