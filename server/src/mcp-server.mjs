import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {httpError,makeAuthentication,requireAuth} from './auth.mjs';
const identifier=z.string().min(1).max(200);
const coordinate=z.object({x:z.number().finite(),y:z.number().finite()}).strict();
const writeVersion={expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(200).optional()};
const paginated={limit:z.number().int().min(1).max(200).optional(),offset:z.number().int().min(0).max(1000000).optional(),q:z.string().max(500).optional()};
const nodeFields={type:z.enum(['note','group','annotation','shape']),noteId:identifier.optional(),position:coordinate, parentId:identifier.nullable().optional(),style:z.object({width:z.number().positive().optional(),height:z.number().positive().optional()}).strict().optional(),data:z.object({label:z.string().max(100000).optional(),shape:z.enum(['rectangle','ellipse']).optional(),color:z.enum(['paper','sage','sand','clay','slate','lilac']).optional(),strokeStyle:z.enum(['solid','dashed']).optional()}).strict().optional(),color:z.enum(['paper','sage','sand','clay','slate','lilac']).optional(),zIndex:z.number().finite().optional(),width:z.number().positive().optional(),height:z.number().positive().optional(),extent:z.literal('parent').optional(),expandParent:z.boolean().optional()};
const edgeFields={source:identifier,target:identifier,label:z.string().max(10000).optional(),route:z.array(coordinate).max(64).optional(),zIndex:z.number().finite().optional(),sourceHandle:identifier.optional(),targetHandle:identifier.optional()};
const noteFields={summary:z.string().min(1).max(10000),body:z.string().max(4000000).optional(),tags:z.array(z.string().min(1).max(160)).max(1000).optional(),kind:z.enum(['story','thought']).optional()};
const mapFields={name:z.string().min(1).max(500),summary:z.string().max(10000).optional(),description:z.string().max(1000000).optional()};
const optionalFields=fields=>Object.fromEntries(Object.entries(fields).map(([key,schema])=>[key,schema.optional()]));
const encoded=value=>encodeURIComponent(value);
export function createMcpServer({apiUrl,token}){
 let base;try{base=new URL(apiUrl)}catch{throw new Error('A valid configured API URL is required.')}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.hash||base.search)throw new Error('Use a configured HTTP(S) API origin without credentials, query or fragment.');
 if(!['','/','/api/v1','/api/v1/'].includes(base.pathname))throw new Error('The configured API URL must use the root or /api/v1 path.');
 if(!/^sct_[A-Za-z0-9_-]{43}$/.test(token||''))throw new Error('A valid Socrates API token is required.');
 base=new URL('/api/v1/',base);
 const server=new McpServer({name:'socrates',version:'1.0.0'},{instructions:'Use workspace_get to obtain compact counts and the current revision before writing. It returns metadata by default; set includeData:true only when a full backup or migration genuinely requires the entire workspace. Use paginated object tools for normal reading. All writes require expectedRevision. On VERSION_CONFLICT preserve your planned changes and read the current workspace before making a deliberate new edit. Note and map delete moves to Trash; purge is permanent and separately scoped. Tokens and credentials are managed in the application, never via tools.'});
 async function request(path,method,args,query={},toolName=''){
  const url=new URL(path.replace(/^\//,''),base);for(const [key,value] of Object.entries(query))if(value!==undefined)url.searchParams.set(key,String(value));
  const {idempotencyKey,...payload}=args||{};
  try{
   const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'X-Socrates-Client':'mcp',...(method!=='GET'?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:method==='GET'?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(30000),redirect:'error'});
   let data=await response.json();
   const pick=(value,names)=>Object.fromEntries(names.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
   const mapSummary=value=>({...pick(value,['id','name','summary','updatedAt','deleted','url']),nodeCount:value.nodes?.length||0,edgeCount:value.edges?.length||0,savedNumber:value.saved?.number||null});
   if(response.ok){
    if(method!=='GET'&&data.data){const {data:workspace,...compact}=data;data=compact;if(data.result?.nodes&&data.result?.edges)data.result=mapSummary(data.result)}
    if(Array.isArray(data.items)){if(toolName==='notes_list')data.items=data.items.map(value=>pick(value,['id','summary','tags','kind','createdAt','updatedAt','deleted','url']));if(toolName==='maps_list')data.items=data.items.map(mapSummary);if(toolName==='revisions_list')data.items=data.items.map(value=>({...pick(value,['number','date','name','summary','label']),noteCount:value.notes?.length||0,nodeCount:value.nodes?.length||0,edgeCount:value.edges?.length||0}))}
   }
   return{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,...(!response.ok?{isError:true}:{})};
  }catch{return{isError:true,content:[{type:'text',text:JSON.stringify({error:{code:'API_UNREACHABLE',message:'The configured Socrates API could not be reached.'}})}]}}
 }
 function register(name,description,inputSchema,method,path,{queryKeys=[],omit=[],destructive=false}={}){
  server.registerTool(name,{description,inputSchema:z.object(inputSchema).strict(),annotations:{readOnlyHint:method==='GET',destructiveHint:destructive,idempotentHint:method==='GET',openWorldHint:false}},async args=>{
   const endpoint=typeof path==='function'?path(args):path;
   const query=Object.fromEntries(queryKeys.map(k=>[k,args[k]]));const payload=Object.fromEntries(Object.entries(args).filter(([k])=>!queryKeys.includes(k)&&!omit.includes(k)));return request(endpoint,method,payload,query,name);
  });
 }
 register('workspace_get','Read the current revision and compact object counts. Full workspace data requires explicit includeData:true for backup or migration.',{includeData:z.boolean().default(false)},'GET',a=>a.includeData?'workspace':'workspace/status',{omit:['includeData']});
 register('workspace_put','Atomically validate and replace the current workspace projection; requires a revision and purge scope for permanent removal.',{...writeVersion,data:z.object({version:z.literal(1),notes:z.array(z.record(z.string(),z.unknown())),tags:z.array(z.string()),maps:z.array(z.record(z.string(),z.unknown())),theme:z.enum(['light','dark','system']),motion:z.boolean()}).strict(),mode:z.enum(['edit','import','replace']).optional()},'PUT','workspace');
 for(const resource of ['notes','maps']){
  const fields=resource==='notes'?noteFields:mapFields;
  const listSchema={...paginated,deleted:z.enum(['true','false','all']).optional(),...(resource==='notes'?{tag:z.string().optional(),kind:z.enum(['story','thought']).optional()}:{})};
  register(`${resource}_list`,`List and search ${resource} as compact summaries; use the get tool for full content.`,listSchema,'GET',resource,{queryKeys:Object.keys(listSchema)});
  register(`${resource}_get`,`Get one ${resource==='notes'?'note':'map'} and its stable application link.`,{id:identifier},'GET',a=>`${resource}/${encoded(a.id)}`,{omit:['id']});
  register(`${resource}_create`,`Create a ${resource==='notes'?'note':'map'}.`,{...writeVersion,...fields,...(resource==='maps'?{noteIds:z.array(identifier).optional()}:{})},'POST',resource);
  register(`${resource}_update`,`Update ${resource==='notes'?'note':'map'} fields.`,{...writeVersion,id:identifier,...optionalFields(fields)},'PATCH',a=>`${resource}/${encoded(a.id)}`,{omit:['id']});
  register(`${resource}_delete`,`Move a ${resource==='notes'?'note':'map'} to Trash.`,{...writeVersion,id:identifier},'DELETE',a=>`${resource}/${encoded(a.id)}`,{omit:['id']});
  register(`${resource}_restore`,`Restore a ${resource==='notes'?'note':'map'} from Trash.`,{...writeVersion,id:identifier},'POST',a=>`trash/${resource}/${encoded(a.id)}/restore`,{omit:['id']});
  register(`${resource}_purge`,`Permanently delete a trashed ${resource==='notes'?'note':'map'}; requires purge scope and no retained references.`,{...writeVersion,id:identifier},'DELETE',a=>`trash/${resource}/${encoded(a.id)}`,{omit:['id'],destructive:true});
 }
 register('notes_references','Find every draft and saved revision referencing a note.',{id:identifier,...paginated},'GET',a=>`notes/${encoded(a.id)}/references`,{omit:['id'],queryKeys:Object.keys(paginated)});
 register('notes_tags_get','Get tags for a note.',{id:identifier,...paginated},'GET',a=>`notes/${encoded(a.id)}/tags`,{omit:['id'],queryKeys:Object.keys(paginated)});
 register('notes_tags_set','Replace tags for a note.',{...writeVersion,id:identifier,tags:z.array(z.string().min(1).max(160))},'PUT',a=>`notes/${encoded(a.id)}/tags`,{omit:['id']});
 register('tags_list','List and search tags with note counts.',paginated,'GET','tags',{queryKeys:Object.keys(paginated)});
 register('tags_suggestions','Suggest tags ordered by their use in active notes.',paginated,'GET','tags/suggestions',{queryKeys:Object.keys(paginated)});
 register('tags_get','Read a tag and linked note IDs.',{name:z.string().min(1).max(160)},'GET',a=>`tags/${encoded(a.name)}`,{omit:['name']});
 register('tags_create','Create a tag.',{...writeVersion,name:z.string().min(1).max(100)},'POST','tags');
 register('tags_rename','Rename a tag across current notes and maps.',{...writeVersion,id:z.string().min(1).max(160),name:z.string().min(1).max(100)},'PATCH',a=>`tags/${encoded(a.id)}`,{omit:['id']});
 register('tags_delete','Remove a tag from the current workspace.',{...writeVersion,id:z.string().min(1).max(160)},'DELETE',a=>`tags/${encoded(a.id)}`,{omit:['id']});
 for(const resource of ['nodes','edges']){
  const fields=resource==='nodes'?nodeFields:edgeFields,route=a=>`maps/${encoded(a.mapId)}/${resource}`;
  register(`${resource}_list`,`List ${resource} in a map.`,{mapId:identifier,...paginated},'GET',route,{omit:['mapId'],queryKeys:Object.keys(paginated)});
  register(`${resource}_get`,`Get a map ${resource==='nodes'?'node':'edge'}.`,{mapId:identifier,id:identifier},'GET',a=>`${route(a)}/${encoded(a.id)}`,{omit:['mapId','id']});
  register(`${resource}_create`,`Create a map ${resource==='nodes'?'node (note, group, shape or annotation)':'edge between note cards'}.`,{...writeVersion,mapId:identifier,...fields},'POST',route,{omit:['mapId']});
  register(`${resource}_update`,`Update a map ${resource==='nodes'?'node':'edge'}.`,{...writeVersion,mapId:identifier,id:identifier,...optionalFields(fields)},'PATCH',a=>`${route(a)}/${encoded(a.id)}`,{omit:['mapId','id']});
  register(`${resource}_delete`,`Remove a map ${resource==='nodes'?'node and incident edges; keep its source note':'edge'}.`,{...writeVersion,mapId:identifier,id:identifier},'DELETE',a=>`${route(a)}/${encoded(a.id)}`,{omit:['mapId','id']});
 }
 register('maps_tags_get','Get a map tag order.',{id:identifier},'GET',a=>`maps/${encoded(a.id)}/tags`,{omit:['id']});
 register('maps_tags_set','Set a map tag order.',{...writeVersion,id:identifier,tagOrder:z.array(z.string())},'PUT',a=>`maps/${encoded(a.id)}/tags`,{omit:['id']});
 register('maps_note_order_set','Set a map note presentation order.',{...writeVersion,id:identifier,noteIds:z.array(identifier)},'PUT',a=>`maps/${encoded(a.id)}/note-order`,{omit:['id']});
 register('revisions_list','List immutable saved map revision metadata; use revisions_get for full frozen content.',{mapId:identifier,...paginated},'GET',a=>`maps/${encoded(a.mapId)}/revisions`,{omit:['mapId'],queryKeys:Object.keys(paginated)});
 register('revisions_get','Read a saved revision including frozen notes.',{mapId:identifier,number:z.number().int().positive()},'GET',a=>`maps/${encoded(a.mapId)}/revisions/${a.number}`,{omit:['mapId','number']});
 register('revisions_create','Save a server-assembled immutable revision from the current draft and current source notes.',{...writeVersion,mapId:identifier,label:z.string().max(160).optional()},'POST',a=>`maps/${encoded(a.mapId)}/revisions`,{omit:['mapId']});
 register('revisions_label','Change a saved revision label without changing its frozen contents.',{...writeVersion,mapId:identifier,number:z.number().int().positive(),label:z.string().max(160)},'PATCH',a=>`maps/${encoded(a.mapId)}/revisions/${a.number}`,{omit:['mapId','number']});
 register('revisions_delete','Permanently delete a saved revision; requires purge scope.',{...writeVersion,mapId:identifier,number:z.number().int().positive()},'DELETE',a=>`maps/${encoded(a.mapId)}/revisions/${a.number}`,{omit:['mapId','number'],destructive:true});
 register('revisions_restore','Restore the draft structure from a saved revision, keeping current source notes.',{...writeVersion,mapId:identifier,number:z.number().int().positive()},'POST',a=>`maps/${encoded(a.mapId)}/revisions/${a.number}/restore`,{omit:['mapId','number']});
 register('trash_list','List trashed notes and maps.',paginated,'GET','trash',{queryKeys:Object.keys(paginated)});
 register('preferences_get','Read theme and motion preferences.',{},'GET','me/preferences');
 register('preferences_update','Update theme and motion preferences.',{...writeVersion,theme:z.enum(['light','dark','system']).optional(),motion:z.boolean().optional()},'PATCH','me/preferences');
 register('activity_list','List activity actions and IDs (never note bodies).',paginated,'GET','activity',{queryKeys:Object.keys(paginated)});
 register('activity_delete','Delete one activity event; requires purge scope.',{id:z.string().uuid()},'DELETE',a=>`activity/${a.id}`,{omit:['id'],destructive:true});
 register('activity_clear','Clear the activity history; requires purge scope.',{},'DELETE','activity',{destructive:true});
 return server;
}
export function mountMcpHttp(app,{pool,apiUrl,publicOrigin=apiUrl}){
 const allowedOrigin=new URL(publicOrigin).origin;
 app.use('/mcp',makeAuthentication(pool),requireAuth,(req,res,next)=>{if(req.auth.kind!=='token')return next(httpError(403,'TOKEN_REQUIRED','MCP requires a scoped API bearer token.'));if(req.get('origin')&&req.get('origin')!==allowedOrigin)return next(httpError(403,'ORIGIN_DENIED','Origin not allowed.'));next()});
 app.post('/mcp',async(req,res,next)=>{
  const server=createMcpServer({apiUrl,token:req.get('authorization').slice(7)}),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void server.close()});
  try{await server.connect(transport);await transport.handleRequest(req,res,req.body)}catch(error){if(!res.headersSent)next(error)}
 });
 app.all('/mcp',(req,res)=>res.status(405).json({jsonrpc:'2.0',error:{code:-32000,message:'Use POST for stateless Streamable HTTP MCP.'},id:null}));
}
