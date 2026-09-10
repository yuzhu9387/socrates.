const PUBLIC_HOST='socrates.dodofamily.com';
const UPSTREAM_HOST='socrates-314788321213.us-west2.run.app';
const unavailable=(message,status)=>new Response(message,{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.hostname!==PUBLIC_HOST)return unavailable('Not found',404);
  if(url.protocol==='http:'){
   url.protocol='https:';
   return Response.redirect(url.href,308);
  }
  const clientIp=request.headers.get('CF-Connecting-IP');
  if(typeof env?.EDGE_PROXY_SECRET!=='string'||env.EDGE_PROXY_SECRET.length<32||!clientIp)return unavailable('Service temporarily unavailable',503);

  // Set the destination directly; a pathname can never select another origin.
  url.hostname=UPSTREAM_HOST;
  url.protocol='https:';
  url.port='';
  const headers=new Headers(request.headers);
  for(const name of ['Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Real-IP','True-Client-IP','X-Socrates-Proxy-IP','X-Socrates-Proxy-Token'])headers.delete(name);
  headers.set('Host',UPSTREAM_HOST);
  headers.set('X-Socrates-Proxy-IP',clientIp);
  headers.set('X-Socrates-Proxy-Token',env.EDGE_PROXY_SECRET);
  // Preserve Origin, authentication, cookies, method and body. Never follow a
  // redirect with credentials or buffer a download/MCP response stream.
  const upstream=new Request(new Request(url.href,request),{headers,redirect:'manual'});
  try{return await fetch(upstream,{cache:'no-store'});}
  catch{return unavailable('Service temporarily unavailable',502);}
 }
};
