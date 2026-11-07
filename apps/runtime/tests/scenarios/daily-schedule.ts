import type {ArtRecord, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ArtSchedulePolicy, ArtScheduleRecord} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {rainNoticeLines} from '@jimmie-potts/event-contracts/v2/art-notice';
import {frameDigest, type SimulatedPixooState} from '@jimmie-potts/pixoo';
import {TRONBYT_SIMULATED_SECTION, type TronbytState} from '@jimmie-potts/tidbyt';
import type {WeatherState} from '@jimmie-potts/weather';
import sharp from 'sharp';
import {SCHEDULE_FIXTURE, RAIN_SECTION, type SubmittedPixooFrames} from '../fixtures/scheduled.js';
import {PIXOO_SECTION} from './modules/pixoo.js';
import {PLAYBACK_SECTION} from './modules/playback.js';
import {StepFailure, act, bodyOf, deviceState, expect, holds, running, type Harness, type Scenario} from './framework.js';

const ART = 'bunny/modules/art', CORE = 'bunny/core';
const art = (h: Harness): ArtRecord | undefined => h.reader.states<ArtRecord>('art', ART)[0]?.data;
const schedule = (h: Harness): ArtScheduleRecord | undefined => h.reader.states<ArtScheduleRecord>('art-schedule', CORE)[0]?.data;
const moments = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation', CORE).map(value => value.data).filter(value => value.family === 'moment-play');
const pixoo = (h: Harness): SimulatedPixooState => deviceState<SimulatedPixooState>(h, 'pixoo');
const tidbyt = (h: Harness): TronbytState => deviceState<TronbytState>(h, 'tidbyt');
const calls = (h: Harness) => deviceState<{imageCalls: number; ideaCalls: number; pending: number}>(h, 'art');
const weatherReads = (h: Harness): number => h.logs().filter(({record}) => ['runtime.sync.served', 'runtime.sync.refused'].includes(record.event_name)
  && record.attributes['bunny.participant'] === CORE && record.attributes['bunny.pattern'] === 'sync weather-state').length;
const saved = (h: Harness): ArtworkSummary | undefined => {
  const value = art(h);return value?.artworks.find(artwork => artwork.artworkId === value.jobs.find(job => job.requestId === 'schedule-seed')?.artworkId);
};
export type ScheduleProof = {startAtMs: number; artworkId: string; pixoo: SubmittedPixooFrames; tidbyt: string[][]; labels: readonly string[]};
const proofs = new WeakMap<Harness, ScheduleProof>();
const expectedStart = new WeakMap<Harness, number>();
const originalComposition = new WeakMap<Harness, string>();
const startOf = (h: Harness): number => expectedStart.get(h) ?? (() => {throw new StepFailure('the bounded opportunity is missing');})();
/**
 * Why the browser selection is missing (#1515): when the core sent `present` relative to the start, the attempt's
 * reason and browser request, that request's operation, and the largest gap between bus messages around the start.
 */
const browserTimeline = (h: Harness): string => {
  const start = startOf(h), at = (time: string): number => Date.parse(time) - start, last = schedule(h)?.lastOpportunity;
  const messages = h.published().map(({message}) => message);
  const present = messages.find(message => message.type === 'org.bunny.art.auto.requested' && (message.data as {action?: string}).action === 'present');
  const operation = last?.browserRequestId == null ? undefined
    : h.reader.states<OperationRecord>('operation', CORE).map(item => item.data).find(item => item.requestId === last.browserRequestId);
  const times = messages.map(message => at(message.time)).filter(offset => offset >= -2000 && offset <= 10_000).sort((a, b) => a - b);
  const gap = times.slice(1).reduce((largest, offset, index) => Math.max(largest, offset - (times[index] as number)), 0);
  return `present ${present === undefined ? 'not sent' : `sent at ${String(at(present.time))} ms`}; attempt reason ${String(last?.reason ?? 'none')}, `
    + `browser request ${last?.browserRequestId ?? 'none'}${operation === undefined ? '' : ` (${operation.status}/${String(operation.result ?? 'pending')})`}; `
    + `checked at ${String(h.now() - start)} ms; ${String(times.length)} bus messages from -2 s to +10 s, largest gap ${String(gap)} ms`;
};

async function read(h: Harness): Promise<ArtScheduleRecord> {
  const answer = await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/automation/art'}), value = bodyOf<ArtScheduleRecord>(answer);
  if (answer.status !== 200 || value?.id !== 'art') throw new StepFailure('the current schedule could not be read');
  return value;
}
async function save(h: Harness, policy: ArtSchedulePolicy): Promise<void> {
  const before = await read(h), answer = await h.gateway({as: 'operator', method: 'PUT', path: '/api/v2/automation/art', headers: {'bunny-request': '1'},
    body: {expectedSettingsRevision: before.settingsRevision, policy}});
  if (answer.status !== 200) throw new StepFailure(`the policy save returned ${String(answer.status)}`);
}
const {nowPlaying: _unusedCard, ...tronbyt} = TRONBYT_SIMULATED_SECTION;

export const artScheduleScenarios: readonly Scenario[] = [{
  id: 'art-schedule', title: 'the saved daily policy presents one exact idea with a fresh factual rain notice and independent display holds',
  memoryTimeoutMs: 90_000, captureTimeoutMs: 240_000, keepCapturePage: true,
  seed: {modules: ['core', 'playback', 'pixoo', 'tidbyt', 'art', 'weather', SCHEDULE_FIXTURE],
    sections: {art: {recentLimit: 8}, weather: RAIN_SECTION},
    config: {playback: PLAYBACK_SECTION, pixoo: {device: {...PIXOO_SECTION.device, id: 'desk-display'}}, tidbyt: {...tronbyt, id: 'shelf-display'}},
    follows: [{owner: ART, families: ['art']}, {owner: CORE, families: ['art-schedule', 'operation']},
      {owner: 'bunny/modules/weather', families: ['weather-state']}, {owner: 'bunny/modules/pixoo', families: ['device']},
      {owner: 'bunny/modules/tidbyt', families: ['device']}]},
  capture: async (context, h) => {
    const proof = proofs.get(h);if (proof === undefined) throw new StepFailure('native rain evidence is missing');
    const {captureArtSchedule} = await import('../../verify/art-schedule-browser.js');await captureArtSchedule(context, proof);
  },
  steps: [
    expect('all real owners and the explicit synthetic fixture are running', h => running(h, ['core', 'art', 'weather', 'pixoo', 'tidbyt', SCHEDULE_FIXTURE])),
    expect('both declared display routes support factual rain notices', h => ['desk-display', 'shelf-display'].every(id => h.reader.states<DeviceRecord>('device').some(({data}) =>
      data.id === id && data.availability === 'available' && data.capabilities.moments.supported && data.capabilities.moments.art?.notices?.includes('rain-forecast') === true)) || 'notice capabilities missing', 5000),
    expect('the real weather owner has a fresh invented rain forecast', h => {
      const state = h.reader.states<WeatherState>('weather-state', 'bunny/modules/weather')[0]?.data;
      return state?.status === 'available' && state.observedAtMs <= h.now() && state.staleAtMs > h.now() + 180_000
        && state.forecast.some(hour => hour.condition === 'rain') || 'fresh synthetic forecast missing';
    }, 5000),
    holds('disabled scheduling reads no weather source and dispatches no moment', h => weatherReads(h) === 0 && moments(h).length === 0
      && schedule(h)?.status === 'disabled' || 'disabled policy read a source or dispatched', 250),
    act('the owner creates one synthetic saved idea for all three surfaces', async h => {
      const answer = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'schedule-seed',
        data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['ui', 'pixoo', 'tidbyt'], text: 'SYNTHETIC_SCHEDULE_MOON_GARDEN'}}});
      if (answer.status !== 200) throw new StepFailure('the synthetic owner request was refused');
    }),
    expect('the real Art owner retains one complete idea and makes only synthetic provider calls', h => {
      const artwork = saved(h);return artwork?.compositions.length === 3 && artwork.compositions.every(value => value.outcome === 'succeeded')
        && calls(h).imageCalls === 3 && calls(h).ideaCalls === 1 || 'three saved compositions missing';
    }, 20_000),
    act('the operator saves the actual enabled policy with weather and explicit display targets', async h => {
      const before = await read(h), now = new Date(h.now()), minute = now.getHours() * 60 + now.getMinutes();
      const composition = saved(h)?.compositions.find(value => value.target === 'pixoo')?.compositionId;
      if (composition == null) throw new StepFailure('saved Pixoo composition missing');originalComposition.set(h, composition);
      await save(h, {...before.policy, enabled: true, wakingStartMinute: minute, wakingEndMinute: (minute + 14 * 60) % 1440,
        appearances: 7, targets: ['desk-display', 'shelf-display'], browser: true, ambient: false, generation: false, weather: true, coversStatus: true});
    }),
    expect('the published fixed opportunity is bounded and the core follows the enabled weather source', h => {
      const record = schedule(h), next = record?.nextOpportunity;
      if (next == null || record?.weather !== 'fresh') return 'schedule or weather has not synced';
      const remaining = next.startAtMs - h.now();
      if (remaining < 45_000 || remaining > 135_000) return `opportunity outside the finite fixture window: ${String(remaining)}`;
      expectedStart.set(h, next.startAtMs);return weatherReads(h) > 0 || 'core did not follow enabled weather';
    }, 5000),
    act('time advances only to the published preparation boundary', h => h.wait(Math.max(0, startOf(h) - 45_000 - h.now()))),
    expect('saved-art preparation admits two independently tracked moments', h => moments(h).length === 2 && moments(h).every(record => record.status === 'accepted')
      && schedule(h)?.lastOpportunity?.displays.every(value => value.prepareRequestId !== null && value.momentRequestId !== null) === true || 'tracked preparations or admissions missing', 12_000),
    act('time advances to the same fixed start chosen by the real schedule', h => h.wait(Math.max(0, startOf(h) - h.now()))),
    expect('the browser and both simulated native displays present the shared idea with the fresh notice', async h => {
      const value = art(h), current = schedule(h), animation = tidbyt(h).installations.bunnymoment?.animation, shown = pixoo(h).shown;
      // Name each missing part so a hosted failure says which surface or record fell behind.
      const missing = [
        value === undefined || !('selection' in value) || value.selection === null ? 'browser selection'
          : value.selection.artworkId !== saved(h)?.artworkId ? 'browser selection of another artwork' : undefined,
        current?.notice == null ? 'schedule notice' : undefined,
        animation === undefined ? 'Tidbyt moment' : animation.frames.length !== 8 || animation.delaysMs.some(delay => delay !== 200)
          ? `Tidbyt animation (${String(animation.frames.length)} frames, delays ${[...new Set(animation.delaysMs)].join('/')})` : undefined,
        shown?.frames !== 8 ? `Pixoo frames (${String(shown?.frames ?? 'none')})` : undefined,
      ].filter(item => item !== undefined);
      if (value === undefined || !('selection' in value) || value.selection === null || current?.notice == null || animation === undefined || missing.length > 0)
        return `exact selected art or native notice animations missing: ${missing.join(', ')}${missing.some(item => item.startsWith('browser') || item === 'schedule notice') ? ` (${browserTimeline(h)})` : ''}`;
      const answer = await h.gateway({as: 'reader', method: 'GET', path: `/modules/${SCHEDULE_FIXTURE}/content/pixoo`});
      const submitted = bodyOf<SubmittedPixooFrames>(answer);
      if (answer.status !== 200 || submitted?.frames.length !== 8 || submitted.frames.some((frame, index) => frame.digest !== pixoo(h).shown?.digests[index] || frame.delayMs !== 200))
        return 'submitted Pixoo frames do not match the simulated native display';
      for (const frame of submitted.frames) {
        const decoded = await sharp(Buffer.from(frame.png, 'base64')).removeAlpha().raw().toBuffer({resolveWithObject: true});
        if (decoded.info.width !== 64 || decoded.info.height !== 64 || frameDigest(decoded.data) !== frame.digest
            || !decoded.data.subarray(50 * 64 * 3, 55 * 64 * 3).includes(255)
            || !decoded.data.subarray(57 * 64 * 3, 62 * 64 * 3).includes(255)) return 'the recorded native PNG lost its forecast band or RGB identity';
      }
      if (animation.frames.some(frame => !frame.slice(20, 25).join('').includes('W') || !frame.slice(26, 31).join('').includes('W')))
        return 'the decoded Tidbyt animation has no separate white forecast lines';
      proofs.set(h, {startAtMs: startOf(h), artworkId: value.selection.artworkId, pixoo: submitted, tidbyt: structuredClone(animation.frames), labels: rainNoticeLines(current.notice.forecast)});
      return true;
    }, 8000),
    act('time advances beyond the Pixoo default ten-second appearance', h => h.wait(Math.max(0, startOf(h) + 12_000 - h.now()))),
    expect('the Pixoo has completed while the independent thirty-second Tidbyt hold remains active', h => moments(h).find(value => value.target === 'desk-display')?.result === 'succeeded'
      && moments(h).find(value => value.target === 'shelf-display')?.result === undefined && tidbyt(h).installations.bunnymoment !== undefined
      || 'the distinct default hold durations were not preserved', 2000),
    act('time advances beyond the Tidbyt default thirty-second appearance', h => h.wait(Math.max(0, startOf(h) + 33_000 - h.now()))),
    expect('both tracked results retain transmission evidence and the temporary tile has been released', h => moments(h).every(value => value.result === 'succeeded' && value.evidence === 'transmitted')
      && tidbyt(h).installations.bunnymoment === undefined || 'separate final outcomes or current-base release missing', 5000),
    expect('reuse made no paid calls and did not change the retained original composition', h => calls(h).imageCalls === 3 && calls(h).ideaCalls === 1
      && saved(h)?.compositions.find(value => value.target === 'pixoo')?.compositionId === originalComposition.get(h) || 'reuse regenerated or replaced the saved original'),
    expect('anonymous clients cannot read the synthetic native evidence', async h => (await h.gateway({as: 'anonymous', method: 'GET',
      path: `/modules/${SCHEDULE_FIXTURE}/content/pixoo`})).status === 401 || 'native fixture evidence was public'),
    act('the operator disables future opportunities through the same revisioned control', async h => {const value = await read(h);await save(h, {...value.policy, enabled: false});}),
    expect('the disabled policy reaches the reader copy', h => schedule(h)?.status === 'disabled' && schedule(h)?.nextOpportunity === null || 'disabled policy has not synced'),
    holds('disable leaves the independent completed outcomes and sends no replay', h => schedule(h)?.status === 'disabled' && moments(h).length === 2
      && calls(h).imageCalls === 3 || 'disable replayed work or lost its settled evidence', 300),
  ],
}];
