#!/usr/bin/env node
import {cli} from '../closeout/closeout.mjs';
process.umask(0o077);
let input;
try{
 if(process.argv.length!==4||process.argv[2]!=='--config')throw new Error();
 let bytes=0;const chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16384)throw new Error();chunks.push(chunk);}
 input=JSON.parse(Buffer.concat(chunks).toString());
 process.stdout.write(JSON.stringify(await cli(process.argv[3],input))+'\n');
}catch{process.stdout.write(JSON.stringify({schemaVersion:1,status:'blocked',repository:input?.repository,issue:input?.issue,merge:input?.merge,effects:input?.operation==='reconcile'?'uncertain':'none',reconciliation:'pending',reason:'closeout-unavailable'})+'\n');}
