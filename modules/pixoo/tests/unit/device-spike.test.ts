import { expect, it } from 'vitest';
import { parseSpikeArgs, runSpike } from '../../packages/device/src/spike.js';
import { FakeDeviceAdapter } from '../../packages/device/src/fake.js';

it.each(['static', 'gif', 'transitions', 'controls', 'reset'])('requires display opt-in for %s before creating a device', stage => {
  expect(() => parseSpikeArgs([stage], { PIXOO_DEVICE_IP: '192.168.1.2' })).toThrow('allow-display-change');
});
it('requires an explicit IP and rejects unknown command flags', () => {
  expect(() => parseSpikeArgs(['probe'], {})).toThrow('PIXOO_DEVICE_IP');
  expect(() => parseSpikeArgs(['probe', '--guess-ip'], {})).toThrow('Unknown');
});
it('runs only the read-only probe stage', async () => {
  const device = new FakeDeviceAdapter();
  const report = await runSpike('probe', device, async () => {});
  expect(report.status).toBe('http-complete-observation-pending');
  expect(device.effects).toEqual([]);
  expect(device.operations.map(operation => operation.kind)).toEqual(['probe']);
});

it('requires confirmation of earlier visual stages before ten transitions', () => {
  expect(() => parseSpikeArgs(['transitions', '--allow-display-change'], { PIXOO_DEVICE_IP: '192.168.1.2' })).toThrow('confirm-prior-stages');
});
it('runs exactly ten alternating transitions and stops on the first failure', async () => {
  const device = new FakeDeviceAdapter();
  const delays: number[] = [];
  const report = await runSpike('transitions', device, async ms => { delays.push(ms); });
  expect(report.operations.map(entry => entry.operation)).toEqual(Array.from({ length: 10 }, (_, index) => index % 2 ? 'two-frame-gif' : 'static-pattern'));
  expect(device.effects.filter(effect => effect.kind === 'frame')).toHaveLength(15);
  expect(delays).toEqual(Array(9).fill(3000));
  device.setOnline(false);
  expect((await runSpike('transitions', device, async () => {})).operations).toHaveLength(1);
});
it('blocks controls when the previous device state is unknown', async () => {
  const device = new FakeDeviceAdapter();
  expect((await runSpike('controls', device, async () => {})).status).toBe('blocked-unknown-control-state');
  expect(device.effects).toEqual([]);
});
