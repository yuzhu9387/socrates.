import {pathToFileURL} from 'node:url';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createMcpServer} from './mcp-server.mjs';
export async function startMcpStdio({apiUrl=process.env.SOCRATES_API_URL||process.env.APP_ORIGIN||'http://127.0.0.1:3001',token=process.env.SOCRATES_API_TOKEN}={}){
 const server=createMcpServer({apiUrl,token});await server.connect(new StdioServerTransport());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){startMcpStdio().catch(error=>{console.error(error.message);process.exitCode=1})}
