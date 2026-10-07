import {loadConfig} from './config.js';
import {blocked,Intake,Response} from './intake.js';
import {RefusalCode} from './error-body.js';
export async function main(args:string[],input:AsyncIterable<Uint8Array>):Promise<Response>{
 // A configuration that is missing, invalid or drifted is the operator's state; a malformed invocation or request is the caller's.
 let code:RefusalCode='invalid-request';
 try{
  if(args.length!==2||args[0]!=='--config')throw new Error();
  code='invalid-state';const config=await loadConfig(args[1]);code='invalid-request';
  let bytes=0;const chunks:Buffer[]=[];
  for await(const chunk of input){bytes+=chunk.length;if(bytes>16384)throw new Error();chunks.push(Buffer.from(chunk));}
  return await new Intake(config).run(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{return blocked('invalid-or-unavailable-intake',code);}
}
