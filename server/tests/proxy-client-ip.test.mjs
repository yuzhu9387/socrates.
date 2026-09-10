import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const secret='socrates-proxy-test-secret-32-characters-minimum';

async function serve(t,app){
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;
}

test('proxy IP requires an exact configured token, valid IP, and strips secret headers',async t=>{
 const {createProxyClientIpMiddleware,authRateLimitKey}=await import('../src/proxy-client-ip.mjs');
 assert.throws(()=>createProxyClientIpMiddleware('too-short'),/32/);
 assert.throws(()=>createProxyClientIpMiddleware(''),/32/);
 assert.throws(()=>createProxyClientIpMiddleware(123),/32/);
 const app=express();app.set('trust proxy',1);app.use(createProxyClientIpMiddleware(secret));
 app.get('/',(req,res)=>res.json({key:authRateLimitKey(req),directIp:req.ip,hasToken:req.get('X-Socrates-Proxy-Token')!==undefined,hasRawToken:req.rawHeaders.some((value,i)=>i%2===1&&req.rawHeaders[i-1].toLowerCase()==='x-socrates-proxy-token'&&value!=='[redacted]')}));
 const url=await serve(t,app);
 async function inspect(headers={}){const response=await fetch(url,{headers:{'X-Forwarded-For':'203.0.113.99, 198.51.100.50',...headers}});assert.equal(response.status,200);return response.json()}
 for(const headers of [
  {'X-Socrates-Proxy-IP':'192.0.2.10'},
  {'X-Socrates-Proxy-IP':'192.0.2.10','X-Socrates-Proxy-Token':'forged'},
  {'X-Socrates-Proxy-IP':'not-an-ip','X-Socrates-Proxy-Token':secret},
  {'X-Socrates-Proxy-IP':'192.0.2.10, 192.0.2.11','X-Socrates-Proxy-Token':secret},
  {'X-Socrates-Proxy-IP':'192.0.2.10:1234','X-Socrates-Proxy-Token':secret},
  {'X-Socrates-Proxy-IP':'[2001:db8::1]','X-Socrates-Proxy-Token':secret},
  {'X-Socrates-Proxy-IP':'fe80::1%eth0','X-Socrates-Proxy-Token':secret},
  {'X-Socrates-Proxy-Token':secret},
 ]){const result=await inspect(headers);assert.equal(result.key,'198.51.100.50');assert.equal(result.directIp,'198.51.100.50');assert.equal(result.hasToken,false);assert.equal(result.hasRawToken,false)}
 const trusted=await inspect({'X-Socrates-Proxy-IP':'192.0.2.10','X-Socrates-Proxy-Token':secret});assert.equal(trusted.key,'192.0.2.10');assert.equal(trusted.directIp,'198.51.100.50');assert.equal(trusted.hasToken,false);assert.equal(trusted.hasRawToken,false);
});

test('unconfigured proxy secret cannot attest IPs and IPv6 limiter keys group by subnet',async t=>{
 const {createProxyClientIpMiddleware,authRateLimitKey}=await import('../src/proxy-client-ip.mjs');
 const app=express();app.set('trust proxy',1);app.use(createProxyClientIpMiddleware());app.get('/',(req,res)=>res.json({key:authRateLimitKey(req),hasToken:req.get('X-Socrates-Proxy-Token')!==undefined}));const url=await serve(t,app);
 const result=await(await fetch(url,{headers:{'X-Forwarded-For':'2001:db8:abcd:1200::1','X-Socrates-Proxy-IP':'192.0.2.8','X-Socrates-Proxy-Token':secret}})).json();assert.equal(result.key,'2001:db8:abcd:1200::/56');assert.equal(result.hasToken,false);
 assert.equal(authRateLimitKey({ip:'2001:db8:abcd:12ff::1234'}),result.key);assert.notEqual(authRateLimitKey({ip:'2001:db8:abcd:1300::1'}),result.key);
});

test('real auth limiter isolates attested clients, retains fallback limits, and grants no data authentication',async t=>{
 const {createApp}=await import('../src/app.mjs');
 const pool={query(){throw new Error('These unauthenticated requests must not reach PostgreSQL')}};
 assert.throws(()=>createApp({pool,edgeProxySecret:'short'}),/32/);
 const app=createApp({pool,origin:'https://socrates.example',trustProxyHops:1,edgeProxySecret:secret});const url=await serve(t,app);
 async function login(ip,token=secret,forwarded='198.51.100.70'){
  const headers={'Content-Type':'application/json','X-Socrates-CSRF':'1',Origin:'https://socrates.example','X-Forwarded-For':forwarded,...(ip?{'X-Socrates-Proxy-IP':ip}:{}),...(token?{'X-Socrates-Proxy-Token':token}:{})};
  return fetch(url+'/api/v1/auth/login',{method:'POST',headers,body:JSON.stringify({email:'invalid',password:'long-enough-password'})});
 }
 for(let i=0;i<30;i++)assert.equal((await login('192.0.2.10')).status,400);assert.equal((await login('192.0.2.10')).status,429);assert.equal((await login('192.0.2.11')).status,400);
 for(let i=0;i<30;i++)assert.equal((await login(`192.0.2.${i+50}`,'forged')).status,400);assert.equal((await login('192.0.2.250',null)).status,429);assert.equal((await login('invalid-ip')).status,429);assert.equal((await login('192.0.2.12')).status,400);
 for(let i=0;i<30;i++)assert.equal((await login('2001:db8:abcd:1200::1')).status,400);assert.equal((await login('2001:db8:abcd:12ff::2')).status,429);assert.equal((await login('2001:db8:abcd:1300::2')).status,400);
 const data=await fetch(url+'/api/v1/workspace',{headers:{'X-Socrates-Proxy-Token':secret,'X-Socrates-Proxy-IP':'192.0.2.11'}});assert.equal(data.status,401);
});
