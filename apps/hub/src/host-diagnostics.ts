import {randomUUID} from 'node:crypto';
import {createHostDiagnostics,type HostDiagnostics} from '@jimmie-potts/bunny-observability/host';
import {createCommandDiagnostics} from './diagnostics.js';
import {object} from './common.js';
import {readBuild} from './build.js';

/** Only the executable host invokes this; library startup remains explicitly injected. */
export async function createHubDiagnostics(configuration:unknown):Promise<{runtime:HostDiagnostics;commands:ReturnType<typeof createCommandDiagnostics>}|undefined> {
  if(configuration===undefined)return undefined;
  if(!object(configuration)||Object.keys(configuration).some(key=>!['enabled','collectorOrigin','tracing','samplingRatio'].includes(key))||
    typeof configuration.enabled!=='boolean'||(configuration.collectorOrigin!==undefined&&typeof configuration.collectorOrigin!=='string')||
    (configuration.tracing!==undefined&&typeof configuration.tracing!=='boolean')||
    (configuration.samplingRatio!==undefined&&(typeof configuration.samplingRatio!=='number'||!Number.isFinite(configuration.samplingRatio)||configuration.samplingRatio<0||configuration.samplingRatio>1)))throw new Error('invalid-configuration');
  if(!configuration.enabled)return undefined;
  const resource={'service.namespace':'bunny','service.name':'hub','service.version':readBuild().version,
    'service.instance.id':randomUUID(),'deployment.environment.name':'development'};
  const runtime=await createHostDiagnostics({enabled:true,resource,collectorOrigin:configuration.collectorOrigin as string|undefined,
    tracing:configuration.tracing as boolean|undefined,samplingRatio:configuration.samplingRatio as number|undefined});
  const commands=createCommandDiagnostics({resource,propagate:true,emit:record=>runtime.emit(record),
    tracer:runtime.tracerFor({resource,scope:(_name,options)=>{
      const kind=(options as {kind?:number}).kind;return kind===2?'bunny.controller':'bunny.http';
    }})});
  return {runtime,commands};
}
