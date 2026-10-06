import type { DeviceAdapter, OperationResult } from './contracts.js';
import { validateDeviceIp } from './http-transport.js';
import { smokeAnimation } from './spike-fixtures.js';

export type SpikeStage = 'probe' | 'static' | 'gif' | 'transitions' | 'controls' | 'reset';
interface SpikeDevice extends DeviceAdapter { resetAnimationIds?(options: { generation: number }): Promise<OperationResult<void>> }
export function parseSpikeArgs(args: string[], env: NodeJS.ProcessEnv): { stage: SpikeStage; ip: string } {
  const [stage, ...flags] = args;
  if (!['probe', 'static', 'gif', 'transitions', 'controls', 'reset'].includes(stage ?? '') ||
      flags.some(flag => !['--allow-display-change', '--confirm-prior-stages'].includes(flag))) throw new Error('Unknown stage or option; see docs/protocol-spike.md');
  if (stage !== 'probe' && !flags.includes('--allow-display-change')) throw new Error('Display-changing stages require --allow-display-change');
  if (stage === 'transitions' && !flags.includes('--confirm-prior-stages')) throw new Error('Observe static and GIF stages first, then use --confirm-prior-stages');
  if (!env.PIXOO_DEVICE_IP) throw new Error('PIXOO_DEVICE_IP is required; no discovery or default IP');
  return { stage: stage as SpikeStage, ip: validateDeviceIp(env.PIXOO_DEVICE_IP) };
}
export async function runSpike(stage: SpikeStage, device: SpikeDevice,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  signal?: AbortSignal) {
  const operations: { operation: string; result: OperationResult<unknown> }[] = [];
  const options = () => ({ generation: device.generation, timeoutMs: 15000, ...(signal && { signal }) });
  async function record<T>(operation: string, pending: Promise<OperationResult<T>>) {
    const result = await pending; operations.push({ operation, result }); return result;
  }
  let failed = false;
  if (stage === 'probe') failed = !(await record('probe', device.probe(options()))).ok;
  else if (stage === 'reset') {
    if (!device.resetAnimationIds) throw new Error('Reset experiment unavailable');
    failed = !(await record('reset-animation-ids', device.resetAnimationIds(options()))).ok;
  } else if (stage === 'controls') {
    const probe = await record('probe', device.probe(options()));
    if (!probe.ok || probe.value.mode !== 'device' || probe.value.brightness === undefined || probe.value.screenOn === undefined) {
      return { stage, status: 'blocked-unknown-control-state', profileEvidence: 'unverified', operations };
    }
    const original = probe.value;
    const steps: [string, () => Promise<OperationResult<void>>][] = [
      ['brightness-dim', () => device.setBrightness(Math.min(original.brightness!, 20), options())],
      ['screen-off', () => device.setScreen(false, options())],
      ['screen-on', () => device.setScreen(true, options())],
      ['restore-screen', () => device.setScreen(original.screenOn!, options())],
      ['restore-brightness', () => device.setBrightness(original.brightness!, options())],
    ];
    for (const [name, action] of steps) {
      if (!(await record(name, action())).ok) { failed = true; break; }
      await sleep(1000);
    }
  } else {
    const count = stage === 'transitions' ? 10 : 1;
    for (let index = 0; index < count; index++) {
      const animated = stage === 'gif' || (stage === 'transitions' && index % 2 === 1);
      if (!(await record(animated ? 'two-frame-gif' : 'static-pattern', device.uploadAnimation(smokeAnimation(animated), options()))).ok) {
        failed = true; break;
      }
      if (index < count - 1) await sleep(3000);
    }
  }
  return { stage, status: failed ? 'failed' : 'http-complete-observation-pending', profileEvidence: 'unverified', operations };
}
