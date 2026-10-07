// The Pixoo module's configuration (Hub #843, module API 1.1): its section of the runtime's configuration file, and the
// conversion of the separate Pixoo service's settings files into it for the installer (#935).
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {DEFAULT_DEVICE_ID, configurePixoo, convertPixooSettings} from '../../src/module/configuration.js';
import {createPixooModule} from '../../src/module/module.js';
import {SimulatedPixoo, httpPixooTransport} from '../../src/module/transport.js';

const device = {id: 'pixoo-1', address: '192.168.1.50', profile: 'pixoo64-gif-2026-10-01'};
const hostedGif = {bind: '0.0.0.0', port: 41240, origin: 'http://192.168.1.10:41240'};
const refused = (answer: unknown): string | undefined => typeof answer === 'object' && answer !== null && 'error' in answer ? (answer as {error: {code: string}}).error.code : undefined;

void describe('the Pixoo\'s section', () => {
  void it('accepts a device with an observed profile and names it as the module\'s device', () => {
    const answer = configurePixoo({device, presentation: {version: 1, mode: 'monitor', filter: {}, cadenceMs: 1000}, nowPlaying: {version: 1, media: 'popup'}}, {simulated: false});
    assert.ok(!('error' in answer));
    assert.deepEqual(answer.devices, ['pixoo-1']);
    assert.equal(answer.config.device.profile.name, 'pixoo64-gif-2026-10-01');
    assert.equal(answer.config.presentation?.mode, 'monitor');
  });

  void it('needs the hosted listener for the hosted profile on a real device, and accepts the simulator\'s profile only when simulated', () => {
    const hosted = {...device, profile: 'pixoo64-hosted-2026-10-01'};
    assert.equal(refused(configurePixoo({device: hosted}, {simulated: false})), 'invalid-request');
    assert.equal(refused(configurePixoo({device: hosted, hostedGif}, {simulated: false})), undefined);
    assert.equal(refused(configurePixoo({device: {...device, profile: 'simulator-v1'}}, {simulated: false})), 'invalid-request');
    assert.equal(refused(configurePixoo({device: {...device, profile: 'simulator-v1'}}, {simulated: true})), undefined);
  });

  void it('refuses what the module cannot use, and never repeats a value in the refusal', () => {
    const cases: unknown[] = [
      undefined, {}, {device: {...device, id: 'Pixoo 1'}}, {device: {...device, address: '8.8.8.8'}}, {device: {...device, address: '192.168.1.500'}},
      {device: {...device, profile: 'unknown'}}, {device: {...device, extra: 1}}, {device, hostedGif: {...hostedGif, origin: 'https://192.168.1.10'}},
      {device, presentation: {version: 2}}, {device, nowPlaying: {version: 1, media: 'always'}}, {device, playback: 'Not An Id'}, {device, other: true},
    ];
    for (const section of cases) {
      const answer = configurePixoo(section, {simulated: false});
      assert.equal(refused(answer), 'invalid-request', JSON.stringify(section));
      for (const value of ['Pixoo 1', '8.8.8.8', '192.168.1.500', 'unknown', 'Not An Id']) {
        assert.ok(!JSON.stringify(answer).includes(value), `the refusal repeats ${value}`);
      }
    }
  });

  void it('is checked by the runtime\'s own configuration check, so a refused section never starts the module', () => {
    const real = createPixooModule({transport: httpPixooTransport()}).manifest;
    assert.equal(checkConfiguration(real, {device}).status, 'accepted');
    const missing = checkConfiguration(real, undefined);
    assert.equal(missing.status === 'refused' && missing.problem.code, 'not-found');
    const simulated = createPixooModule({transport: new SimulatedPixoo()}).manifest;
    assert.equal(checkConfiguration(simulated, {device: {...device, profile: 'simulator-v1'}}).status, 'accepted');
  });
});

void describe('the settings conversion', () => {
  void it('turns the Pixoo service\'s files into a section the module accepts, keeping the Hub\'s device ID', () => {
    const section = convertPixooSettings({
      device: {version: 1, configuration: {ip: '192.168.1.50', model: 'Pixoo-64', profile: 'pixoo64-hosted-2026-10-01'}},
      hostedGif, presentation: {version: 1, mode: 'monitor', filter: {provider: 'claude'}, cadenceMs: 2000}, nowPlaying: {version: 1, media: 'whole'},
    });
    assert.ok(!('error' in section));
    assert.deepEqual(section, {
      device: {id: DEFAULT_DEVICE_ID, address: '192.168.1.50', profile: 'pixoo64-hosted-2026-10-01', model: 'Pixoo-64'}, hostedGif,
      presentation: {version: 1, mode: 'monitor', filter: {provider: 'claude'}, cadenceMs: 2000}, nowPlaying: {version: 1, media: 'whole'},
    });
    assert.equal(refused(configurePixoo(section, {simulated: false})), undefined);
    assert.equal(JSON.stringify(section).includes('secret'), false, 'the section names no secret');
  });

  void it('refuses files that are not a version 1 device configuration, or that the module would refuse', () => {
    assert.equal(refused(convertPixooSettings({device: {version: 2, configuration: {}}})), 'invalid-request');
    assert.equal(refused(convertPixooSettings({device: {version: 1, configuration: {ip: '192.168.1.50', profile: 'pixoo64-hosted-2026-10-01'}}})), 'invalid-request');
    assert.equal(refused(convertPixooSettings({device: {version: 1, configuration: {ip: '192.168.1.50', profile: 'pixoo64-gif-2026-10-01'}}}, {id: 'Desk'})), 'invalid-request');
  });
});
