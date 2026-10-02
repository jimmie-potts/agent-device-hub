import { acquireLease } from './lease.js';
import { executeOperation,type Operation } from './operations.js';
import type { CollectorConfig } from './config.js';
import { safeCode } from './supervisor.js';
const disconnected=()=>process.exit(1);
process.once('disconnect',disconnected);
process.once('message',async (message:{config:CollectorConfig;operation:Operation;workerMemoryLimit:number})=>{
  let guard:ReturnType<typeof acquireLease>|undefined;
  const connected=()=>{if(!Number.isSafeInteger(message.workerMemoryLimit)||message.workerMemoryLimit<1||message.workerMemoryLimit>512*1024*1024)throw new Error('invalid-config');if(process.memoryUsage().rss>message.workerMemoryLimit)throw new Error('source-capacity');if(!process.connected)throw new Error('run-cancelled');};
  const send=(value:unknown)=>{connected();process.send!(value as object);};
  const heartbeat=setInterval(()=>{try{send({type:'memory',rss:process.memoryUsage().rss});}catch(error){if(process.connected)process.send!({type:'failure',code:safeCode(error)},()=>process.exit(1));else process.exit(1);}},50);
  try{
    guard=acquireLease(message.config.stateDirectory,'worker-lease.sqlite');connected();
    const result=await executeOperation(message.config,message.operation,{maxMemoryBytes:message.workerMemoryLimit,phase:phase=>send({type:'phase',phase}),memory:rss=>send({type:'memory',rss}),checkpoint:()=>connected()});
    send({type:'success',result});
  }catch(error){if(process.connected)process.send!({type:'failure',code:safeCode(error)});process.exitCode=1;}
  finally{clearInterval(heartbeat);guard?.release();process.removeListener('disconnect',disconnected);if(process.connected)process.disconnect();}
});
