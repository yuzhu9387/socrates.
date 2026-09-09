import express from 'express';
import helmet from 'helmet';
import {resolve} from 'node:path';
import {ZodError} from 'zod';
import {csrfProtection,httpError,makeAuthentication} from './auth.mjs';
import {accountRoutes} from './routes-account.mjs';
import {workspaceRoutes} from './routes-workspace.mjs';
import {mountMcpHttp} from './mcp-server.mjs';
export function createApp({pool,origin='http://127.0.0.1:3001',secureCookies=false,allowRegistration=false,staticDir,logger=console}){
 if(!pool)throw new Error('createApp requires a PostgreSQL pool.');
 const app=express();app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],fontSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:secureCookies?[]:null}},crossOriginEmbedderPolicy:false,hsts:secureCookies?undefined:false}));
 app.get(['/health/live','/api/v1/health/live'],(req,res)=>res.json({status:'ok'}));
 app.get(['/health/ready','/api/v1/health/ready'],async(req,res,next)=>{try{await pool.query('SELECT 1 FROM workspaces LIMIT 1');res.json({status:'ready'})}catch{next(httpError(503,'NOT_READY','Database is not ready.'))}});
 app.use('/mcp',express.json({limit:'12mb'}));
 mountMcpHttp(app,{pool,apiUrl:origin});
 app.use('/api/v1',express.json({limit:'12mb'}),(req,res,next)=>{res.set('Cache-Control','no-store');next()},makeAuthentication(pool),csrfProtection(origin));
 app.use('/api/v1',accountRoutes({pool,secureCookies,allowRegistration}));
 app.use('/api/v1',workspaceRoutes({pool,origin}));
 app.use('/api',(req,res,next)=>next(httpError(404,'NOT_FOUND','API endpoint not found.')));
 if(staticDir){app.use(express.static(resolve(staticDir),{index:false}));app.get('/{*path}',(req,res)=>res.sendFile(resolve(staticDir,'index.html')))}
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error instanceof ZodError)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'The request contains invalid fields.',details:error.issues.map(x=>({path:x.path,message:x.message}))}});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:{code:'INVALID_JSON',message:'The request body must contain valid JSON.'}});
  if(error.type==='entity.too.large')return res.status(413).json({error:{code:'BODY_TOO_LARGE',message:'The request body exceeds the size limit.'}});
  const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
  if(status===500)logger?.error?.({event:'request_error',code:error.code||'INTERNAL_ERROR',method:req.method});
  res.status(status).json({error:{code:status===500?'INTERNAL_ERROR':error.code||'REQUEST_FAILED',message:status===500?'The request could not be completed.':error.message,...(error.details?{details:error.details}:{}),...(error.currentRevision!==undefined?{currentRevision:error.currentRevision}:{})}});
 });
 return app;
}
