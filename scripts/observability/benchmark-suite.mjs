import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {freezeProtocol} from './protocol.mjs';
import {benchmarkSource} from './benchmark-source.mjs';
import {runBenchmark} from './benchmark-run.mjs';
import {summarizeBenchmarkPair} from './benchmark-pair.mjs';

/** Exactly the preregistered six pairs, serially. No retries, duration overrides,
 * threshold changes or restart of an existing suite directory. */
export async function runBenchmarkSuite({directory,stateParent,endpoint,ports,signal}) {
  if(resolve(directory)!==directory||await realpath(dirname(directory))!==dirname(directory))throw new Error('Benchmark evidence directory invalid');
  const source=await benchmarkSource();
  await mkdir(directory,{mode:0o700});
  const frozen=await freezeProtocol(directory,{...source,runId:basename(directory),createdAt:new Date().toISOString()});
  const protocol=JSON.parse(await readFile(frozen.path,'utf8')),pairs=[];let failure=null;
  try {
    for(const pair of protocol.pairs) {
      const runs=[];
      for(const mode of pair.order) {
        if(signal?.aborted)throw new Error('Benchmark aborted');
        if(!isDeepStrictEqual(await benchmarkSource(),source))throw new Error('Frozen source changed');
        const runId=`${pair.condition}-${pair.number}-${mode}`,runDirectory=join(directory,runId);
        await writeFile(join(directory,runId+'-intent.json'),JSON.stringify({protocolSha256:frozen.sha256,pair,mode,runDirectory},null,2)+'\n',{flag:'wx',mode:0o600});
        const result=await runBenchmark({directory:runDirectory,stateParent,endpoint,ports,condition:pair.condition,enabled:mode==='enabled',signal});
        if(!isDeepStrictEqual(await benchmarkSource(),source))throw new Error('Frozen source changed during run');
        runs.push(result);
        // Known metric failures do not erase the prescribed remaining pairs.
        // Unconfirmed runtime cleanup/prerequisites stop further allocations.
        if(result.preparationFailure||!result.backendComplete||!result.cleanupComplete)throw new Error('Benchmark lifecycle incomplete');
      }
      const result=summarizeBenchmarkPair({...pair,runs});pairs.push(result);
      await writeFile(join(directory,`${pair.condition}-${pair.number}-pair.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    }
  }catch{failure='benchmark-suite-incomplete';}
  const dispositions=pairs.map(pair=>pair.evaluation.disposition);
  const disposition=dispositions.includes('refuted')?'refuted':failure||pairs.length!==6||dispositions.includes('inconclusive')?'inconclusive':'supported';
  const result={scope:'paired-benchmarks-only',protocolSha256:frozen.sha256,source,failure,disposition,pairs,
    fullPilotAcceptance:false};
  await writeFile(join(directory,'benchmark-suite.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
