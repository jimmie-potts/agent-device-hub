// A run's health, as its readiness probe and `doctor` report it (Hub #954): the runtime's own health document, judged
// as the in-memory harness judges a scenario's start. Every module runs, except one the run's seed expects the runtime
// to refuse, such as a module it configures badly, and the lag check has not stopped. The reason names each module that
// is not as expected, with its state and registry code, and nothing else from the document.
import type {RuntimeHealth} from '../src/index.js';

export type HealthVerdict = {ok: true} | {ok: false; reason: string};

/** Whether `health` is what the run expects, given the modules its seed expects the runtime to refuse. */
export function judgeHealth(health: RuntimeHealth, refused: readonly string[] = []): HealthVerdict {
  const problems = health.modules
    .filter(module => !module.healthy && !(module.state === 'refused' && refused.includes(module.name)))
    .map(module => `${module.name} ${module.state}${module.reason === undefined ? '' : ` (${module.reason.code})`}`);
  if (health.lagCheck.status === 'stopped') problems.push('the lag check stopped');
  return problems.length === 0 ? {ok: true} : {ok: false, reason: `the runtime is ${health.status}: ${problems.join(', ')}`};
}
