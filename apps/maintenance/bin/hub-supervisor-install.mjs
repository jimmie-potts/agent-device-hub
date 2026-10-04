#!/usr/bin/env node
import {cli} from '../install/hub.mjs';
process.umask(0o077);
let input;
try{
 if(process.argv.length!==4||process.argv[2]!=='--config')throw new Error();
 let size=0;const parts=[];for await(const part of process.stdin){size+=part.length;if(size>16384)throw new Error();parts.push(part);}
 input=JSON.parse(Buffer.concat(parts).toString());process.stdout.write(JSON.stringify(await cli(process.argv[3],input))+'\n');
}catch{process.stdout.write(JSON.stringify({schemaVersion:1,repository:input?.repository,merge:input?.merge,owner:input?.owner,status:'uncertain',effects:'uncertain',reason:'hub-install-adapter-unavailable'})+'\n');}
