import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../deploy/cloudflare/proxy.mjs';

const origin='https://socrates.dodofamily.com';
const backend='https://socrates-314788321213.us-west2.run.app';
const env={EDGE_PROXY_SECRET:'a'.repeat(64)};
const request=(path='/',options={})=>new Request(origin+path,{...options,headers:{'CF-Connecting-IP':'203.0.113.4',...options.headers}});

test('Worker preserves bilingual POST bodies, login cookies, bearer tokens and CSRF origin',async t=>{
 let sent;
 t.mock.method(globalThis,'fetch',async (req,options)=>{sent={req,options};return new Response('ok');});
 const body=JSON.stringify({summary:'思考 / Thinking'});
 await worker.fetch(request('/api/v1/notes?q=%E4%B8%AD%E6%96%87',{method:'POST',headers:{Cookie:'socrates_session=example',Authorization:'Bearer example',Origin:origin,'X-Socrates-CSRF':'1','X-Socrates-Account':'account-1','Content-Type':'application/json'},body}),env);
 assert.equal(sent.req.url,backend+'/api/v1/notes?q=%E4%B8%AD%E6%96%87');
 assert.equal(sent.req.method,'POST');
 assert.equal(await sent.req.text(),body);
 for(const [name,value] of Object.entries({Cookie:'socrates_session=example',Authorization:'Bearer example',Origin:origin,'X-Socrates-CSRF':'1','X-Socrates-Account':'account-1'}))assert.equal(sent.req.headers.get(name),value);
 assert.equal(sent.req.redirect,'manual');
 assert.equal(sent.options.cache,'no-store');
});

test('Worker replaces caller-supplied proxy headers and removes forwarded address claims',async t=>{
 let sent;
 t.mock.method(globalThis,'fetch',async req=>{sent=req;return new Response('ok');});
 await worker.fetch(request('/',{headers:{'X-Socrates-Proxy-IP':'1.2.3.4','X-Socrates-Proxy-Token':'forged','X-Forwarded-For':'1.2.3.4',Forwarded:'for=1.2.3.4','X-Real-IP':'1.2.3.4',Host:'attacker.example'}}),env);
 assert.equal(sent.headers.get('X-Socrates-Proxy-IP'),'203.0.113.4');
 assert.equal(sent.headers.get('X-Socrates-Proxy-Token'),env.EDGE_PROXY_SECRET);
 assert.equal(sent.headers.get('Host'),new URL(backend).host);
 for(const name of ['X-Forwarded-For','Forwarded','X-Real-IP'])assert.equal(sent.headers.get(name),null);
});

test('Worker keeps an untrusted Origin so Socrates can reject CSRF',async t=>{
 let sent;
 t.mock.method(globalThis,'fetch',async req=>{sent=req;return new Response('denied',{status:403});});
 const response=await worker.fetch(request('/api/v1/notes',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'}),env);
 assert.equal(sent.headers.get('Origin'),'https://attacker.example');
 assert.equal(response.status,403);
});

test('Worker streams MCP and retains multiple cookies and download headers',async t=>{
 let streamController;
 const stream=new ReadableStream({start(controller){streamController=controller;}});
 const upstream=new Response(stream,{headers:{'Content-Type':'text/event-stream','Content-Disposition':'attachment; filename="notes.md"'}});
 upstream.headers.append('Set-Cookie','first=1; Secure; HttpOnly');
 upstream.headers.append('Set-Cookie','second=2; Secure; HttpOnly');
 let sent;
 t.mock.method(globalThis,'fetch',async req=>{sent=req;return upstream;});
 const response=await worker.fetch(request('/mcp',{headers:{Accept:'text/event-stream','Mcp-Session-Id':'session','Mcp-Protocol-Version':'2025-03-26'}}),env);
 assert.equal(response,upstream);
 assert.equal(response.bodyUsed,false);
 assert.equal(sent.headers.get('Mcp-Session-Id'),'session');
 assert.equal(sent.headers.get('Mcp-Protocol-Version'),'2025-03-26');
 assert.equal(response.headers.getSetCookie().length,2);
 assert.match(response.headers.get('Content-Disposition'),/notes.md/);
 streamController.enqueue(new TextEncoder().encode('data: live\n\n'));
 streamController.close();
 assert.equal(await response.text(),'data: live\n\n');
});

test('Worker rejects alternate hosts and never treats a path as a new upstream',async t=>{
 const urls=[];
 t.mock.method(globalThis,'fetch',async req=>{urls.push(req.url);return new Response('ok');});
 assert.equal((await worker.fetch(new Request('https://socrates-proxy.workers.dev/'),env)).status,404);
 await worker.fetch(request('//attacker.example/private?url=https://attacker.example'),env);
 assert.equal(urls.length,1);
 assert.equal(new URL(urls[0]).origin,backend);
});

test('Worker redirects HTTP to the same HTTPS host without forwarding credentials',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('HTTP must not reach upstream'));
 const response=await worker.fetch(new Request('http://socrates.dodofamily.com/#/notes'),env);
 assert.equal(response.status,308);
 assert.equal(response.headers.get('Location'),'https://socrates.dodofamily.com/#/notes');
});

test('Worker fails closed when its edge secret or Cloudflare client IP is missing',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('Misconfigured edge must not send upstream requests'));
 for(const invalid of [{},{EDGE_PROXY_SECRET:'short'}])assert.equal((await worker.fetch(request(),invalid)).status,503);
 assert.equal((await worker.fetch(new Request(origin),env)).status,503);
});

test('Worker leaves redirects manual and hides upstream connection errors',async t=>{
 const redirect=new Response(null,{status:302,headers:{Location:'https://external.example/'}});
 t.mock.method(globalThis,'fetch',async req=>{assert.equal(req.redirect,'manual');return redirect;});
 assert.equal(await worker.fetch(request(),env),redirect);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Private upstream detail');});
 const response=await worker.fetch(request(),env);
 assert.equal(response.status,502);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.doesNotMatch(await response.text(),/Private|aaaaaa/);
});
