import assert from 'node:assert/strict';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {SIMULATED_SECTION, SimulatedPixoo, createPixooModule} from '@jimmie-potts/pixoo';
import {MOMENT_INSTALLATION, SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedTronbyt, TRONBYT_ORIGIN, createTidbytModule} from '@jimmie-potts/tidbyt';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {flush, it, manualClock, stateDir} from './support.js';

for (const device of ['pixoo', 'tidbyt'] as const) it(`${device}: a missed moment start reaches its owner and is recorded refused, with no effect`, async context => {
  const clock = manualClock(Date.now());
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const dir = await stateDir(context);
  const coreSdk = bus.connect('bunny/core');
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  // The module harness uses bunny/modules/<name>; the runtime gives the core its reserved source.
  const coreHost = new ModuleHarness({...core, start: given => core.start({...given, sdk: coreSdk})},
    {bus, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  const pixoo = new SimulatedPixoo();
  const tronbyt = new SimulatedTronbyt();
  const target = device === 'pixoo' ? SIMULATED_SECTION.config.device.id : 'tidbyt';
  const displayHost = new ModuleHarness(device === 'pixoo' ? createPixooModule({transport: pixoo}) : createTidbytModule({transport: tronbyt.fetch}), {
    bus, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler,
    section: device === 'pixoo' ? SIMULATED_SECTION.config : {
      id: target, backend: 'tronbyt', tronbyt: {url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE},
      statusInstallation: 'agentdevicehub', secrets: {token: '/synthetic/tronbyt-token'},
    },
    secrets: {token: SIMULATED_API_KEY},
  });
  context.after(async () => {await displayHost.stop(); await coreHost.stop(); await coreSdk.close();});
  await coreHost.start();
  await displayHost.start();
  assert.ok(handle);
  const action = {
    key: `bunny.cmd.moment-play.${target}`, requestId: `missed-${device}`, requestedBy: 'bunny/parts/operator',
    draft: {type: 'org.bunny.moment.play.requested', subject: target, dataschema: 'https://bunny.invalid/events/moment-play/2.0',
      data: {momentId: 'missed-moment', mood: 'celebrate', durationMs: 8000, priorityClass: 'event', coversStatus: true,
        startAtMs: clock.now() - 2000, toleranceMs: 1000}},
  };
  const reply = await core.actions.dispatch(action);
  const operation = handle.operation(action.requestId);
  assert.equal(operation?.responder, `bunny/modules/${device}`, 'the display owner received and answered the command');
  assert.deepEqual([operation?.status, operation?.result, operation?.evidence, operation?.error?.code],
    ['rejected', 'failed', 'none', 'invalid-state']);
  assert.equal(operation?.error?.detail, device === 'pixoo' ? 'the moment missed its start window' : "the moment's start window has passed");
  assert.equal('error' in reply && reply.error.code, 'invalid-state');
  clock.advance(60_000);
  await flush();
  assert.deepEqual(await core.actions.dispatch(action), reply, 'the same request returns its saved refusal');
  assert.deepEqual(handle.operation(action.requestId), operation, 'time and duplicate requests do not replay the moment');
  assert.equal(pixoo.state().sent, 0, 'no Pixoo upload or display write');
  assert.equal(tronbyt.state().calls.some(call => call.path.endsWith(`/${MOMENT_INSTALLATION}`) || (call.path.endsWith('/push') && call.method === 'POST')), false,
    'no Tronbyt moment installation or push');
});
