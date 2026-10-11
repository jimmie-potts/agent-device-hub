import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {createOnnModule} from './module.js';
import {onnSchemas, registerOnnFamilies} from './families.js';
import {SimulatedOnn} from './simulated.js';
import type {Attempt, OnnAction} from './transport.js';
export const ONN_SIMULATED_SECTION = Object.freeze({id: 'onn', configurationRevision: 1, adbSocket: '/not-configured/s', serial: '192.0.2.10:12345', hostExecutable: '/not-configured/adb', hostExecutableSha256: '0'.repeat(64), hostVersion: '37.0.1', hostKeyDirectory: '/not-configured/keys'});
const simulation: DeviceSimulation<SimulatedOnn, SimulatedOnn> = {
  actions: ['online', 'offline', 'physical-youtube', 'physical-stremio'], admits: (_action, values) => Object.keys(values).length === 0,
  memory: {create: () => new SimulatedOnn(), state: device => device.state(), act: (device, value) => {device.act(value.action);}, build: device => createOnnModule({transport: device})},
  run: {
    create: () => new SimulatedOnn(), state: device => device.state(), act: (device, value) => {device.act(value.action);},
    serve: (device, request) => request.method === 'execute' ? device.execute(request.args as OnnAction, request.signal) : device.read(request.signal),
    remote: link => createOnnModule({transport: {
      async execute(action, signal, beforeEffect) {
        const code = beforeEffect(); if (code !== undefined) return {result: 'failed', evidence: 'none', code};
        const answer = await link.call('execute', action, signal);
        return answer.status === 'answered' ? answer.value as Attempt : {result: 'uncertain', evidence: 'none', code: 'uncertain-result'};
      },
      async read(signal) {
        const answer = await link.call('read', {}, signal);
        if (answer.status !== 'answered' || typeof answer.value !== 'object' || answer.value === null) return undefined;
        const app = 'app' in answer.value ? answer.value.app : undefined;
        return app === 'youtube' || app === 'stremio' || app === 'other' || app === 'none' ? {app} : {};
      },
    }}),
  },
};
export const registration: ModuleRegistration = {
  name: 'onn', shipped: true, order: 500, create: () => createOnnModule(), simulate: () => createOnnModule({transport: new SimulatedOnn()}),
  schemas: onnSchemas, registerFamilies: registerOnnFamilies, simulatedSection: {config: ONN_SIMULATED_SECTION}, simulation,
};
