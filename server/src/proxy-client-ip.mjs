import {createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {ipKeyGenerator} from 'express-rate-limit';

const tokenHeader='x-socrates-proxy-token';
const ipHeader='x-socrates-proxy-ip';
const attestedAddresses=new WeakMap();
const digest=value=>createHash('sha256').update(value).digest();

export function validateEdgeProxySecret(secret){
 if(secret===undefined)return;
 if(typeof secret!=='string'||secret.length<32||Buffer.byteLength(secret,'utf8')<32)throw new Error('EDGE_PROXY_SECRET must contain at least 32 characters when configured.');
}

export function createProxyClientIpMiddleware(secret){
 validateEdgeProxySecret(secret);
 const expected=secret===undefined?null:digest(secret);
 return(req,res,next)=>{
  const token=req.headers[tokenHeader],address=req.headers[ipHeader];
  // The attestation is private input to rate limiting, never application auth.
  attestedAddresses.delete(req);
  if(expected&&typeof token==='string'&&timingSafeEqual(digest(token),expected)&&typeof address==='string'&&!address.includes('%')&&isIP(address))attestedAddresses.set(req,address);
  // Remove the shared token before routes, error handling, or request logging.
  delete req.headers[tokenHeader];
  // Keep Node's raw header count intact for its lazy headersDistinct accessor.
  if(Array.isArray(req.rawHeaders))for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()===tokenHeader)req.rawHeaders[i+1]='[redacted]';
  if(req.headersDistinct)delete req.headersDistinct[tokenHeader];
  next();
 };
}

export function authRateLimitKey(req){
 // Both attested and direct IPv6 clients retain express-rate-limit's /56 grouping.
 return ipKeyGenerator(attestedAddresses.get(req)??req.ip);
}
