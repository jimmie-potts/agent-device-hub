import type {FastifyInstance} from 'fastify';
import {createMcpHandler,type McpHandler} from '@jimmie-potts/device-mcp';
import {authenticateCredential,validateMcpConfiguration} from './mcp-config.js';
import {createLocalTools} from './mcp-tools.js';
import type {ControlService} from './control-service.js';
export async function registerMcp(app:FastifyInstance,directory:string,service:ControlService,changed:()=>void):Promise<void>{
 await validateMcpConfiguration(directory);
 const {registry,tools}=createLocalTools(service,changed);
 let handler:McpHandler|undefined;
 app.addHook('onRequest',async(request,reply)=>{
  if(request.url!=='/mcp')return;
  if(!handler){
   const address=app.server.address(),port=typeof address==='object'&&address?address.port:80;
   const hosts=['127.0.0.1','localhost'].map(host=>port===80?host:`${host}:${port}`);
   handler=createMcpHandler({enabled:true,registry,tools,allowedHosts:hosts,allowedOrigins:[...new Set(hosts.map(host=>new URL(`http://${host}`).origin))],authenticate:async bearer=>authenticateCredential(directory,bearer)});
  }
  reply.hijack();
  await handler.handle(request.raw,reply.raw);
 });
 app.all('/mcp',(_request,reply)=>reply.code(404).send());
 app.addHook('preClose',async()=>{await handler?.close();});
}
