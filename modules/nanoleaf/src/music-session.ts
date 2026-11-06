// The live Music session on Lines (#1272, design D4): the core's `music-lighting-work` admitted over a named Free base,
// then run by the device's existing locked worker, as a bounded moment is (moments.ts). The frozen saved preset renders
// the newest fresh feature from the capture binding (music-input.ts, music-effects.ts). The first frame is the Start's
// journaled write; later frames are the module's own paints of the admitted session. A Stop, an alert or source loss
// restores the named base only while nothing newer took over; a newer choice, an external change or a failed write
// ends it with no restoration. Nothing retries, resends, resumes or falls back to another input or light.
import type {LightingCapture, LightingEndReason, LightingRestoration} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import {Cancelled, Execution, Refused} from './controls.js';
import {DEFAULT, type Element, type Kind, type LayoutEntry} from './devices.js';
import {Rejected, type Display} from './effects.js';
import {ValueError} from './errors.js';
import {finish, finishMusicStops, held, journal, journalRow, type End, type JournalRow, type Report, type Transact} from './journal.js';
import type {Indication} from './line-projection.js';
import {alerting, newerChoice, NEWER_CHOICES, restoreFreeBase, type Admitted, type DeviceRead, type FreeBase} from './moments.js';
import {MusicRenderer, type MusicRecipeV1} from './music-effects.js';
import {musicBinding, MusicInput, type MusicBinding, type MusicClock, type MusicSample} from './music-input.js';
import {readReactiveCatalog} from './music-presets.js';
import {endSession, liveSession, markPlaying, musicSession, MUSIC_PLAY, MUSIC_STOP, saveStarting} from './music-store.js';
import type {RenderConfig} from './renderer.js';
import {execute, type Db} from './sqlite.js';
import {controlState, markDirty, overrides, type Overrides} from './store.js';
import type {LightRequest} from './transport.js';

export {MUSIC_PLAY, MUSIC_STOP, musicDeviceState, initMusicSessions} from './music-store.js';

/** How long a Start waits for its first fresh feature before it ends as source loss. */
export const FIRST_FEATURE_MS = 2000;
/** The least time between two frame writes: at most ten a second, with no catch-up. */
export const FRAME_MS = 100;
/** How often a playing session reads the device for an external scene or brightness change. */
export const EXTERNAL_CHECK_MS = 1000;
/** How often the session loop wakes to check for a stop, a newer choice, an alert and a fresh feature. */
export const POLL_MS = 25;
/** A Music session yields to everything a moment yields to, and to a newer moment. */
const NEWER_THAN_MUSIC = [...NEWER_CHOICES, 'moment.play'] as const;

/** A Start as the journal keeps it: the frozen recipe and layout, the Free base and what it was admitted over. */
export type MusicStart = {
  kind: typeof MUSIC_PLAY; requestId: string; generation: string; capture: LightingCapture; presetId: string; recipe: MusicRecipeV1;
  layout: {kind: Kind; elements: Element[]}; freeBase: FreeBase; configurationRevision: number; overrides: Overrides;
};
export type MusicStop = {kind: typeof MUSIC_STOP; requestId: string; generation: string};
export type StartRequest = {requestId: string; generation: string; capture: LightingCapture; presetId: string};

/** The current features of each device's admitted session, in memory only: features are never persisted. */
export class MusicFeeds {
  readonly #inputs = new Map<string, {generation: string; input: MusicInput}>();

  /** `clock` reads the runtime's one clock for both of the input's readings, so a clock step back retires the input. */
  constructor(readonly clock: () => MusicClock) {}

  /** Opens a new input for an admitted session, retiring any earlier one of the device's. */
  open(device: string, generation: string, binding: MusicBinding): void {
    this.#inputs.get(device)?.input.retire();
    this.#inputs.set(device, {generation, input: new MusicInput(binding, this.clock())});
  }

  input(device: string, generation: string): MusicInput | undefined {
    const entry = this.#inputs.get(device);
    return entry?.generation === generation ? entry.input : undefined;
  }

  /** Offers one features message to every open input; each takes only its own endpoint and generation. */
  accept(message: unknown): void {
    for (const {input} of this.#inputs.values()) input.accept(message, this.clock());
  }

  /** A gap in the features (a subscription overflow) is source loss for every session: nothing resumes on a later frame. */
  retireAll(): void {
    for (const {input} of this.#inputs.values()) input.retire();
  }
}

/** A sample for the admission render: its values do not change a frame's size, which only the layout sets. */
const probe = (binding: MusicBinding): MusicSample => ({endpointId: binding.endpointId, elapsedMs: 0, feature: {
  generation: binding.generation, input: 'music', sequence: 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 0, endMonotonicMs: 100, emittedMonotonicMs: 100, observedAtMs: 0, validUntilMs: 400, rms: 1, peak: 1, clippedFraction: 0,
  bands: {bass: 1, mid: 1, treble: 1}, onset: {strength: 1, confidence: 1}, discontinuity: false,
}});

/**
 * The checks a Start passes, in the design's order, before the device read and again in its admission: the Lines, Free
 * with no pending mode, no hold, no live session and no other content, a saved preset the renderer accepts with the
 * saved layout, and its expiry. The frozen recipe and layout.
 */
export function checkMusicStart(db: Db, device: string, start: StartRequest, layout: LayoutEntry | undefined, nowMs: number,
  expiresMs: number): {recipe: MusicRecipeV1; layout: MusicStart['layout']} {
  if (device !== DEFAULT) throw new Refused('unsupported-capability', 'Live Music plays on the Lines only.');
  const control = controlState(db, device);
  if (control.mode !== 'free' || control.revision !== control.applied) throw new Refused('invalid-state', 'Live Music starts only on a light already in Free.');
  if (held(db, control.revision, device)) throw new Refused('unavailable', 'A device hold waits for an explicit choice.');
  if (liveSession(db, device)) throw new Refused('invalid-state', 'A Music session is already starting or playing.');
  if (journal(db, device).length > 0) throw new Refused('capacity', 'Other content waits on the Lines.');
  let recipe: MusicRecipeV1 | undefined;
  try {
    recipe = readReactiveCatalog(db).presets.find(preset => preset.presetId === start.presetId)?.recipe;
  } catch {
    throw new Refused('invalid-state', 'The saved reactive library cannot be read.');
  }
  if (recipe === undefined) throw new Refused('not-found', 'No saved reactive preset has this ID.');
  if (layout === undefined) throw new Refused('invalid-state', 'The saved Lines layout is not available yet.');
  let binding: MusicBinding;
  try {
    binding = musicBinding(start.capture);
  } catch {
    throw new Refused('invalid-request', 'The capture binding is invalid.');
  }
  const frozen = {kind: layout.kind, elements: layout.elements.map(element => ({...element, zones: [...element.zones],
    position: element.position === null ? null : [...element.position]}))};
  try {
    if (new MusicRenderer(recipe, frozen, binding).render(probe(binding)) === null) throw new Rejected('unsupported-capability');
  } catch (error) {
    if (error instanceof ValueError || error instanceof TypeError) {
      throw new Refused('unsupported-capability', 'The Lines cannot render this preset with the saved layout.');
    }
    throw error;
  }
  if (nowMs >= expiresMs) throw new Refused('expired', 'The Start expired.');
  return {recipe, layout: frozen};
}

/**
 * Admits a Start over the Free base read before it, inside the caller's transaction: checks again, journals its
 * `music.play`, saves the session as starting and wakes the worker. The caller opens the session's input after commit.
 */
export function admitMusicStart(db: Db, device: string, start: StartRequest, layout: LayoutEntry | undefined, freeBase: FreeBase,
  configurationRevision: number, nowMs: number, expiresMs: number, report: Report): MusicStart {
  const {recipe, layout: frozen} = checkMusicStart(db, device, start, layout, nowMs, expiresMs);
  const control = controlState(db, device);
  const command: MusicStart = {kind: MUSIC_PLAY, requestId: start.requestId, generation: start.generation, capture: {...start.capture},
    presetId: start.presetId, recipe, layout: frozen, freeBase, configurationRevision, overrides: overrides(db, device)};
  insert(db, device, command, control.revision, nowMs, expiresMs);
  const row = journalRow(db, start.requestId);
  saveStarting(db, device, start.generation, start.requestId, {binding: command.capture, presetId: command.presetId, recipe, freeBase,
    modeRevision: control.revision, configurationRevision, seq: row?.seq ?? null}, report);
  markDirty(db);
  return command;
}

/** Admits a Stop for a session still starting or playing; the session's loop takes it. */
export function admitMusicStop(db: Db, device: string, stop: MusicStop, nowMs: number, expiresMs: number): void {
  if (!liveSession(db, device, stop.generation)) throw new Refused('invalid-state', 'No Music session of this generation is starting or playing.');
  if (nowMs >= expiresMs) throw new Refused('expired', 'The Stop expired.');
  insert(db, device, stop, controlState(db, device).revision, nowMs, expiresMs);
  markDirty(db);
}

function insert(db: Db, device: string, command: MusicStart | MusicStop, revision: number, nowMs: number, expiresMs: number): void {
  execute(db, "INSERT INTO control_journal (id, device, kind, command, mode_revision, phase, accepted, expires) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
    command.requestId, device, command.kind, JSON.stringify(command), revision, nowMs / 1000, expiresMs / 1000);
}

/** At module start no session runs: one left starting or playing ends as a restart, with no device write and no replay. */
export function endMusicAtStart(db: Db, device: string, nowMs: number, report: Report): void {
  const session = musicSession(db, device);
  if (session !== undefined && session.status !== 'ended') endSession(db, device, session.generation, 'restart', 'none', nowMs, report);
}

/**
 * At a worker's start, a session whose loop ended with the last worker ends as a restart: one playing, or one starting
 * whose Start is no longer queued. A Start still queued is the new worker's to run.
 */
export function endInterruptedMusic(db: Db, device: string, nowMs: number, report: Report): void {
  const session = musicSession(db, device);
  if (session === undefined || session.status === 'ended') return;
  if (session.status === 'starting' && journalRow(db, session.startId)?.phase === 'queued') return;
  endSession(db, device, session.generation, 'restart', 'none', nowMs, report);
  finishMusicStops(db, device, session.generation, {kind: 'refused', code: 'invalid-state'}, report, nowMs);
}

/** The selection a device reports while it shows a frame: a static display or an animated one. */
const shownBy = (payload: Display): string => payload.write.animType === 'static' ? '*Static*' : '*Dynamic*';

export type MusicPlayback = {
  db: Db; device: string; row: JournalRow; config: RenderConfig; transact: Transact; request: LightRequest;
  /** The runtime's clock in epoch milliseconds, and the input's clock readings. */
  now: () => number; clock: () => MusicClock;
  sleep: (seconds: number) => Promise<void>;
  /** The session's input, or none when no input was opened for it. */
  input: MusicInput | undefined;
  /** Recompute from the current store, including current alert/status. */
  current: () => readonly Indication[];
  /** The first frame took the device. */
  taken: () => void;
  /** The module is stopping: a request it ended is not a device failure, and the session is left for the next start. */
  stopping: () => boolean;
};

/** Runs one admitted session to its end inside the worker's locked pass. Never retries or resends a write. */
export async function playMusic(options: MusicPlayback): Promise<void> {
  const {db, device, row, config, transact, request, now, clock, sleep, input, current, stopping} = options;
  const command = row.command as MusicStart;
  const {generation, freeBase} = command;
  const target = {ip: config.ip ?? '', token: config.token ?? ''};
  // A rejected device request ends the session as a device failure, unless the module is stopping.
  let deviceFailed = false;
  const flagged = <T>(promise: Promise<T>): Promise<T> => promise.catch((error: unknown) => {
    deviceFailed = true;
    throw error;
  });
  const read: DeviceRead = endpoint => flagged(request(target, 'GET', endpoint));
  const send = (endpoint: string, payload: unknown): Promise<unknown> => flagged(request(target, 'PUT', endpoint, payload));
  const since: Admitted = {seq: row.seq, revision: row.revision, configurationRevision: command.configurationRevision, overrides: command.overrides};
  const stale = (): boolean => !liveSession(db, device, generation) || held(db, row.revision, device) || newerChoice(db, device, since, NEWER_THAN_MUSIC);
  const stopRow = (): JournalRow | undefined =>
    journal(db, device, 'AND kind=?', MUSIC_STOP).find(stop => (stop.command as MusicStop).generation === generation);
  /** Rethrows anything but a device request's failure while the module runs. */
  const deviceFailure = (error: unknown): void => {
    if (!deviceFailed || stopping()) throw error;
  };
  /** Ends the session, its Start if it is still journaled, the Stop that ended it, and any other Stop for it, in one transaction. */
  const end = (reason: LightingEndReason, restoration: LightingRestoration, startEnd: End = {kind: 'retired'}, stop?: JournalRow): Promise<void> =>
    transact(report => {
      const at = now();
      endSession(db, device, generation, reason, restoration, at, report);
      const start = journalRow(db, row.id);
      if (start !== undefined) finish(db, start, startEnd, report, at);
      const live = stop === undefined ? undefined : journalRow(db, stop.id);
      if (live !== undefined) finish(db, live, {kind: live.completed > 0 ? 'sent' : 'unchanged'}, report, at);
      finishMusicStops(db, device, generation, reason === 'stopped' ? {kind: 'unchanged'} : {kind: 'refused', code: 'invalid-state'}, report, at);
    });

  // Before the first frame: a Stop, a newer choice, an alert or the Start's expiry ends it; a fresh feature starts it.
  let renderer: MusicRenderer;
  try {
    renderer = new MusicRenderer(command.recipe, command.layout, command.capture);
  } catch {
    await end('device', 'none', {kind: 'refused', code: 'unsupported-capability'});
    return;
  }
  const deadline = now() + FIRST_FEATURE_MS;
  let first: {sample: MusicSample; payload: Display} | undefined;
  while (first === undefined) {
    const stop = stopRow();
    if (stop !== undefined) return end('stopped', 'none', {kind: 'refused', code: 'cancelled'}, stop);
    if (stale()) return end('manual', 'none');
    if (alerting(current())) return end('alert', 'none', {kind: 'refused', code: 'invalid-state'});
    if (now() >= row.expires * 1000) return end('expired', 'none', {kind: 'expired'});
    const sample = input?.current(clock()) ?? null;
    if (sample !== null) {
      let payload: Display | null;
      try {
        payload = renderer.render(sample);
      } catch (error) {
        if (error instanceof Rejected) return end('device', 'none', {kind: 'refused', code: error.code});
        throw error;
      }
      if (payload !== null) {
        first = {sample, payload};
        break;
      }
    }
    if (now() >= deadline) return end('source-lost', 'none', {kind: 'refused', code: 'unavailable'});
    await sleep(POLL_MS / 1000);
  }
  const {payload} = first;
  const shown = shownBy(payload);
  // The first frame is the Start's own journaled write: a lost answer ends it uncertain and holds the device, and an
  // answered refusal fails it; either way `finish` ends the session as a device failure.
  try {
    await new Execution(db, row.revision, row.id, device, transact, now).call(() => send('/effects', payload));
  } catch (error) {
    if (error instanceof Cancelled) return end('manual', 'none');
    deviceFailure(error);
    return end('device', 'none', {kind: 'uncertain'});
  }
  await transact(report => {
    markPlaying(db, device, generation, report);
    const start = journalRow(db, row.id);
    if (start !== undefined) finish(db, start, {kind: 'sent'}, report, now());
  });
  options.taken();

  // Later frames are the module's own paints of the admitted session: no command waits on them, so a lost answer holds
  // nothing (as the worker's indicator paints) and ends the session as a device failure, with no retry.
  const paint = new Execution(db, row.revision, null, device, transact, now);
  /** Each restoration write is guarded before and after, so a newer choice wins over the rest of it. */
  const restore = async (stop: JournalRow | undefined): Promise<LightingRestoration> => {
    const writer = stop === undefined ? paint : new Execution(db, row.revision, stop.id, device, transact, now);
    try {
      return await restoreFreeBase(read, freeBase, shown, stale, async (endpoint, body) => {
        if (stale()) throw new Cancelled();
        const result = await writer.call(() => send(endpoint, body));
        if (stale()) throw new Cancelled();
        return result;
      }) ? 'restored' : 'skipped';
    } catch (error) {
      if (!(error instanceof Cancelled)) deviceFailure(error);
      return 'skipped';
    }
  };
  let lastWrite = now();
  let lastSequence = first.sample.feature.sequence;
  let lastCheck = now();
  for (;;) {
    await sleep(Math.max(POLL_MS, lastWrite + FRAME_MS - now()) / 1000);
    const stop = stopRow();
    if (stop !== undefined) return end('stopped', await restore(stop), undefined, stop);
    if (stale()) return end('manual', 'none');
    if (alerting(current())) return end('alert', await restore(undefined));
    const next = input?.current(clock()) ?? null;
    if (next === null) return end('source-lost', await restore(undefined));
    if (now() - lastCheck >= EXTERNAL_CHECK_MS) {
      lastCheck = now();
      let showing: boolean;
      try {
        // An external scene, brightness or power choice is a manual takeover. A scene chosen between two frames is
        // painted over by the next one, so only a read that lands before that frame sees it.
        const listing = await read('/effects') as {select?: unknown};
        const state = listing.select === shown ? await read('/state') as {on?: {value?: unknown}; brightness?: {value?: unknown}} : undefined;
        showing = state?.brightness?.value === freeBase.brightness && state.on?.value !== false;
      } catch (error) {
        deviceFailure(error);
        return end('device', 'none');
      }
      if (!showing) return end('manual', 'none');
      // The read took time: every check runs again before the next write.
      continue;
    }
    if (next.feature.sequence === lastSequence || now() - lastWrite < FRAME_MS) continue;
    let frame: Display | null;
    try {
      frame = renderer.render(next);
    } catch (error) {
      if (error instanceof Rejected) return end('device', 'none');
      throw error;
    }
    if (frame === null || stale()) continue;
    try {
      await paint.call(() => send('/effects', frame));
    } catch (error) {
      // A hold or a mode command overtook the write before it was sent: the next check ends the session.
      if (error instanceof Cancelled) continue;
      deviceFailure(error);
      return end('device', 'none');
    }
    lastWrite = now();
    lastSequence = next.feature.sequence;
  }
}
