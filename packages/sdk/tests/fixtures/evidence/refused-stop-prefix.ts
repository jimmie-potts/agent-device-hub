// Hub #1126 F1 before 465ab14d: a gesture's transmission was acknowledged, then
// the closing Stop was refused. The refusal proves the Stop was transmitted, but
// the pre-fix catch discarded it and rebuilt the claim from `stopped` alone, so
// the acknowledged transmission was reported as nothing sent. With Evidence the
// rebuilt claim no longer type-checks: the type must not compile.
import {absent, transmitted, type Evidence} from '../../../src/evidence.js';

declare function stop(): Promise<void>;

export async function closeGesture(): Promise<Evidence<'transmitted'>> {
  let evidence: Evidence<'transmitted'> = transmitted();
  let stopped = false;
  try {await stop(); stopped = true;}
  catch {evidence = stopped ? transmitted() : absent();}
  return evidence;
}
