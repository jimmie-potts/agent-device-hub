// The playback module a disposable run builds over its link (Hub #1711): without the run's clocks it judges freshness on
// its own real monotonic clock, as an installed runtime does, and with them on the run's monotonic clock. Both cases
// move the clocks by hand; nothing waits on real time.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {DeviceLink, RemoteSimulationOptions} from '@jimmie-potts/sdk';
import {playbackSimulation} from '../src/registration.js';
import {SimulatedSpeakers} from '../src/simulated.js';
import {SECTION, host, manualClock, test, type Hosted} from './support.js';

const playing = (title: string) => ({input: 'airplay', status: 'playing', title, artist: 'Artist'}) as const;

/** A link that serves each call from `speakers` in this process, as the run's supervisor does over its link. */
const linkTo = (speakers: SimulatedSpeakers): DeviceLink => ({
  call: async (method, args, signal = new AbortController().signal) => {
    try {
      return {status: 'answered', value: await playbackSimulation.run.serve(speakers, {method, args, signal, current: true})};
    } catch {
      return signal.aborted ? {status: 'abandoned'} : {status: 'failed'};
    }
  },
  handover: undefined,
  onPush: () => {},
});

/** The HT-A9 alone, playing, hosted as the run's remote module on a manual wall clock; `options` as a run gives them. */
async function remote(context: TestContext, options?: (clock: ReturnType<typeof manualClock>) => RemoteSimulationOptions): Promise<{hosted: Hosted; speakers: SimulatedSpeakers}> {
  const speakers = new SimulatedSpeakers({sony: playing('Song')});
  const clock = manualClock();
  const hosted = await host(context, speakers, {
    clock, section: {id: SECTION.id, sources: [SECTION.sources[1]]},
    module: () => playbackSimulation.run.remote(linkTo(speakers), options?.(clock)),
  });
  await hosted.advance(2000);
  assert.equal(hosted.record().availability, 'available');
  speakers.silent('sony');
  return {hosted, speakers};
}

// The module next looks at a silent speaker's age when it would turn stale by its wall clock, 5 s after the last answer.
// By then 30 s have passed on one monotonic clock: on the clock the module follows, the speaker is unavailable at once.

test('a run\'s remote module without the run\'s clocks judges freshness on performance.now, as an installed runtime does', async context => {
  let monotonic = 1_000_000;
  context.mock.method(performance, 'now', () => monotonic);
  const {hosted} = await remote(context);
  monotonic += 30_000;
  await hosted.advance(5000);
  assert.equal(hosted.record().availability, 'unavailable', 'freshness follows performance.now');
});

test('a run\'s remote module with the run\'s clocks does not judge freshness on performance.now', async context => {
  let real = 1_000_000;
  context.mock.method(performance, 'now', () => real);
  const {hosted} = await remote(context, clock => ({now: clock.now, scheduler: clock.scheduler, monotonic: clock.now}));
  real += 30_000;
  await hosted.advance(5000);
  assert.equal(hosted.record().availability, 'stale', 'performance.now moving on does not age the speaker');
});

test('a run\'s remote module with the run\'s clocks judges freshness on the run\'s monotonic clock', async context => {
  let run = 5_000_000;
  const {hosted} = await remote(context, clock => ({now: clock.now, scheduler: clock.scheduler, monotonic: () => run}));
  run += 30_000;
  await hosted.advance(5000);
  assert.equal(hosted.record().availability, 'unavailable', 'freshness follows the run\'s monotonic clock');
});
