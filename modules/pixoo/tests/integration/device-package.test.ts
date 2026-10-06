import { expect, it } from 'vitest';
import { FakeDeviceAdapter, type DeviceAdapter } from '@pixoo/device';

it('exports a usable adapter from the built workspace with the default clock', async () => {
  const fake = new FakeDeviceAdapter();
  const device: DeviceAdapter = fake;
  expect(await device.probe({ generation: device.generation })).toMatchObject({
    ok: true, value: { mode: 'simulator', available: true, connected: false },
  });
  expect((await device.setBrightness(0, { generation: device.generation })).ok).toBe(true);
  expect((await device.setScreen(true, { generation: device.generation })).ok).toBe(true);
  expect(fake.effects.map(effect => effect.kind)).toEqual(['brightness', 'screen']);
});
