import { mkdirSync } from 'node:fs';
import { win32 } from 'node:path';
import { parseArgs } from './arguments.js';
import { loadConfig,qualifyState } from './config.js';
import { recordInterruptedAttempt } from './operations.js';
import { requestStop,supervise,safeCode } from './supervisor.js';

const started=Date.now();
try{
  if(process.platform!=='win32')throw new Error('unsupported-platform');
  if(Number(process.versions.node.split('.')[0])!==24)throw new Error('unsupported-runtime');
  const {configPath,operation}=parseArgs(process.argv.slice(2));
  const config=loadConfig(configPath);
  if(operation.command==='collect'&&!config.collectionEnabled)throw new Error('collection-disabled');
  const output=operation.command==='export'?operation.output:undefined;
  if(output&&win32.normalize(output).toLowerCase()===win32.normalize(configPath).toLowerCase())throw new Error('unsafe-path');
  qualifyState(config,output);mkdirSync(config.stateDirectory,{recursive:true});
  if(['clear','clear-text','reset'].includes(operation.command))await requestStop(config.stateDirectory,Math.min(10000,Math.max(1,60_000-(Date.now()-started))));
  const remaining=60_000-(Date.now()-started);if(remaining<1)throw new Error('run-deadline');
  const result=await supervise({directory:config.stateDirectory,entry:new URL('./run-worker.js',import.meta.url),payload:{config,operation},runDeadlineMs:remaining,onFailure:code=>recordInterruptedAttempt(config,code)});
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
}catch(error){
  const message=error instanceof Error?error.message:'';
  const code=['invalid-arguments','unsupported-runtime','collector-busy'].includes(message)?message:safeCode(error);
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
