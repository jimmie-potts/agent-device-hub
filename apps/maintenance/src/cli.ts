import {loadConfig} from './config.js';
import {blocked,Intake,Response} from './intake.js';
export async function main(args:string[],input:AsyncIterable<Uint8Array>):Promise<Response>{
 try{
  if(args.length!==2||args[0]!=='--config')throw new Error();
  const config=await loadConfig(args[1]);let bytes=0;const chunks:Buffer[]=[];
  for await(const chunk of input){bytes+=chunk.length;if(bytes>16384)throw new Error();chunks.push(Buffer.from(chunk));}
  return await new Intake(config).run(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{return blocked('invalid-or-unavailable-intake');}
}
