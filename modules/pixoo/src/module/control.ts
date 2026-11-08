import {PlaybackRouteError} from '../library/playback-policy.js';
// The Pixoo's command handling (Hub #843). It replaces divoom-app-upgrade's ControlService for the Hub mode, the status
// view, player, playlist and catalog requests: each request becomes a call on the player, the presentation or the library, and
// its result becomes a completed outcome under ADR 0012's "Errors, effects and outcomes". It knows nothing of the bus;
// the module (`module.ts`) admits a command, replies, and reports the completion this file returns through its outbox.
import {AsyncLocalStorage} from 'node:async_hooks';
import {errorBody, type ErrorCode, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {MomentEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {HubMode, NowPlayingMedia} from '../core/index.js';
import type {OperationResult} from '../device/index.js';
import {LibraryError, type ItemInput, type Library, type PlaybackPolicy} from '../library/index.js';
import {MediaError, type MediaProfile, type Transform} from '../media/index.js';
import {PlaybackError, type MediaOperationEvent, type Player} from '../playback/index.js';
import {ApiError, type MomentPlay, type MonitorPresentation, type ViewChange} from '../presentation/index.js';
import {Outcome} from '@jimmie-potts/sdk';

/** A command's completed result, as the outcome payload reports it, and what reached the device for it. */
export type Completion = {
  result: 'succeeded' | 'failed' | 'uncertain';
  evidence: 'transmitted' | 'observed' | 'none';
  error?: ErrorDetail;
  /** The send that reached the device's transport, for a transmitted completion: when, and which operations. */
  transmission?: {transmittedAtMs: number; operationIds: string[]};
  /** How a moment that reached the device ended: the `moment-ended` occurrence that commits with this outcome. */
  ended?: Pick<MomentEnded, 'ending' | 'endedAtMs'>;
};

/** The player actions of the general `media-control` command. */
export type MediaAction = 'pause' | 'resume' | 'stop' | 'next' | 'previous' | 'restart-with-changes' | 'clear';
/** One change to the library's playlists. */
export type PlaylistChange =
  | {operation: 'create'; name: string; repeat?: boolean; shuffle?: boolean; playlistId?: string; items?: ItemInput[]}
  | {operation: 'rename'; playlistId: string; revision: number; name: string}
  | {operation: 'options'; playlistId: string; revision: number; repeat?: boolean; shuffle?: boolean}
  | {operation: 'items'; playlistId: string; revision: number; items: ItemInput[]}
  | {operation: 'order'; playlistId: string; revision: number; itemIds: string[]}
  | {operation: 'duplicate'; playlistId: string; revision: number; name: string}
  | {operation: 'delete'; playlistId: string; revision: number};
/** One change to the library's media: an import of bytes, a new rendition of an asset, or an asset's deletion. */
export type AssetChange =
  | {operation: 'import'; name: string; bytes: Uint8Array}
  | {operation: 'render'; assetId: string; transform?: Transform}
  | {operation: 'delete'; assetId: string};

/** The module's own state already shows the change: it committed it, and its state message is the observation. */
export const OBSERVED: Completion = Object.freeze({result: Outcome.succeeded, evidence: Outcome.observed});
const failed = (code: ErrorCode, detail: string): Completion => ({result: Outcome.failed, evidence: Outcome.none, error: errorBody(code, {detail}).error});
/** A command whose effect may have begun but whose result is unknown: never a refusal (ADR 0012). */
const uncertain = (detail: string): Completion => ({result: Outcome.uncertain, evidence: Outcome.none, error: errorBody('uncertain-result', {detail}).error});

// Device failure codes. A connectivity failure is the device being unavailable; nothing in the result says it acted.
const DEVICE_CODES: Readonly<Record<string, ErrorCode>> = {
  offline: 'unavailable', timeout: 'unavailable', 'http-error': 'unavailable', 'protocol-error': 'unavailable', 'upload-failed': 'unavailable',
  'device-error': 'invalid-state', 'too-large': 'too-large', 'invalid-input': 'invalid-request', 'profile-limit': 'unsupported-capability', cancelled: 'cancelled', 'stale-generation': 'cancelled',
};
/** Failures in which the Pixoo answered, so the request reached it: with an error status or code, or unreadably. */
const ANSWERED: readonly string[] = ['device-error', 'http-error', 'protocol-error'];
/**
 * A device operation's completion. A confirmed send is `succeeded` with `transmitted`: the Pixoo's answer is a transport
 * acknowledgment, never an observation. A failure the Pixoo answered reached it, so its evidence is `transmitted`, never
 * `none`: an error status or code is `failed`, and an answer that cannot be read is `uncertain`. Every send the Pixoo
 * answered, failed or not, is the device's last transmission, as the device profile requires. Of the failures it did
 * not answer, one that may have reached it is `uncertain` with no evidence (MAPPING.md's receipt rule 2), and one that
 * certainly did not is `failed`. No result means a newer request superseded it before it was sent.
 */
export function deviceCompletion(result: OperationResult<unknown> | undefined, operation: string): Completion {
  if (result === undefined) return failed('cancelled', 'a newer request superseded it before it was sent');
  const transmission = {transmittedAtMs: result.timing.completedAtMs, operationIds: [operation]};
  if (result.ok) return {result: Outcome.succeeded, evidence: Outcome.transmitted, transmission};
  if (result.code === 'protocol-error') {
    return {result: Outcome.uncertain, evidence: Outcome.transmitted, error: errorBody('uncertain-result', {detail: `the device's answer to the ${operation} send could not be read`}).error, transmission};
  }
  if (ANSWERED.includes(result.code)) {
    return {result: Outcome.failed, evidence: Outcome.transmitted, error: errorBody(DEVICE_CODES[result.code] ?? 'internal', {detail: `the device refused the ${operation} send: ${result.code}`}).error, transmission};
  }
  if (result.priorEffects === 'possible') return uncertain(`the ${operation} send may have reached the device: ${result.code}`);
  return failed(DEVICE_CODES[result.code] ?? 'internal', `the ${operation} send did not reach the device: ${result.code}`);
}

// Domain refusals that prove no effect began: they come from admission checks before the player, the presentation or the
// library changed anything.
const REFUSALS: Readonly<Record<string, ErrorCode>> = {
  cancelled: 'cancelled', busy: 'capacity', 'not-found': 'not-found', 'revision-conflict': 'revision-conflict', 'no-context': 'invalid-state',
  'screen-off': 'invalid-state', closed: 'unavailable', 'invalid-input': 'invalid-request', 'unsupported-operation': 'invalid-request',
  'profile-limit': 'unsupported-capability', unsupported: 'invalid-request', 'decode-failed': 'invalid-request', 'upload-limit': 'too-large',
  'pixel-limit': 'too-large', 'asset-referenced': 'invalid-state', 'checkpoint-owned': 'invalid-state', timeout: 'unavailable',
};
/** A domain error's code: the player's, the library's, the media store's and the presentation's errors each carry one. */
function domainCode(error: unknown): string | undefined {
  if (error instanceof PlaybackError || error instanceof LibraryError || error instanceof MediaError || error instanceof ApiError) return error.code;
  // A playback store reports a superseded capture with a plain error that carries the code, as the library's does.
  const code: unknown = error instanceof Error ? (error as Error & {code?: unknown}).code : undefined;
  return typeof code === 'string' && Object.hasOwn(REFUSALS, code) ? code : undefined;
}
/**
 * The completion of a request whose call threw. A domain error from an admission check is `failed` with its registry
 * code, because nothing changed; anything else, such as a storage failure after the player adopted new work, is
 * `uncertain`, because an effect may have begun. The exception itself stays in memory.
 */
export function errorCompletion(error: unknown): Completion {
  if (error instanceof PlaybackRouteError) return failed('unsupported-capability', error.detail);
  if (error instanceof MediaError && error.code === 'storage-limit') return failed('too-large', 'The media exceeds the byte limit for one file.');
  if (error instanceof MediaError && error.code === 'storage-capacity') return failed('capacity', 'Pixoo media storage is full.');
  const code = domainCode(error);
  if (code === undefined) return uncertain('the request failed after it began');
  const mapped = REFUSALS[code];
  return mapped === undefined ? uncertain(`the request failed after it began: ${code}`) : failed(mapped, `the request was refused: ${code}`);
}

/** Quiet's brightness (ADR 0014): the configured level, and the brightness remembered before Quiet, which the module stores. */
export type QuietBrightness = {level: number; remembered: () => number | undefined; remember: (percent: number | undefined) => void};

export type ControlOptions = {
  player: Player;
  monitor: MonitorPresentation;
  /** Quiet's brightness. Without it a mode command writes no brightness. */
  quiet?: QuietBrightness;
  /** The library, for playlist and media changes. Without it they fail as `unavailable`. */
  library?: Library;
  /** The active media profile, which renditions and playback use. */
  profile?: Readonly<MediaProfile>;
};

const STARTS: readonly MediaAction[] = ['resume', 'restart-with-changes'];

/** Applies the Pixoo's requests to its player, Monitor presentation and library, and reports each one's completion. */
export class PixooControl {
  readonly #player: Player;
  readonly #monitor: MonitorPresentation;
  readonly #library: Library | undefined;
  readonly #profile: Readonly<MediaProfile> | undefined;
  readonly #quiet: QuietBrightness | undefined;
  /**
   * Each playback command runs its player action under its own token, as ControlService ran it under its request, so the
   * media operation its action launches is known by the async context that launched it, whatever other commands do
   * meanwhile.
   */
  readonly #commands = new AsyncLocalStorage<object>();
  /** The first media operation each command's action launched. */
  readonly #launched = new WeakMap<object, number>();
  /** Media operations a command launched: the player generation each ran for, its result once known, or the command's wait for it. */
  readonly #tracked = new Map<number, {generation: number; result?: OperationResult<unknown>; resolve?: (result: OperationResult<unknown>) => void}>();
  readonly #unsubscribe: () => void;

  constructor({player, monitor, library, profile, quiet}: ControlOptions) {
    this.#player = player;
    this.#quiet = quiet;
    this.#monitor = monitor;
    this.#library = library;
    this.#profile = profile;
    this.#unsubscribe = player.subscribeMediaOperations(event => { this.#observe(event); });
  }

  /** Starts a playlist (`media-start`): the completion is its first upload's. */
  start(playlistId: string): Promise<Completion> {
    return this.#playback(() => this.#player.start(playlistId), true);
  }

  /** Shows one rendition with an optional playback policy (`pixoo-media-show`): the completion is its upload's. */
  show(renditionId: string, playback?: PlaybackPolicy): Promise<Completion> {
    return this.#playback(() => this.#player.showMedia(renditionId, playback), true);
  }

  /**
   * One player action (`media-control`). Pause, stop and clear change only the module's own playback, so they complete
   * as observed; resume, next, previous and restart-with-changes complete with the upload they start. Resume and
   * restart-with-changes take the display from the status base, and the others interrupt it.
   */
  control(action: MediaAction): Promise<Completion> {
    // A moment paused this playlist, not the owner, so a next or previous during it keeps playing.
    const held = this.#monitor.momentHoldsMedia();
    const run = (): Promise<void> => {
      switch (action) {
        case 'pause': return this.#player.pause();
        case 'resume': return this.#player.resume();
        case 'stop': return this.#player.stop();
        case 'next': return held ? this.#monitor.keepPlaying(() => this.#player.next()) : this.#player.next();
        case 'previous': return held ? this.#monitor.keepPlaying(() => this.#player.previous()) : this.#player.previous();
        case 'restart-with-changes': return this.#player.restartWithChanges();
        case 'clear': return this.#player.clear();
      }
    };
    return this.#playback(run, STARTS.includes(action));
  }

  /** Sets the brightness (`brightness-set`): the completion is the device write's. */
  async brightness(percent: number): Promise<Completion> {
    try {
      return deviceCompletion(await this.#player.setBrightness(percent), 'display');
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /** Switches the screen (`power-set`). Off first suspends the status base, as ControlService did. */
  async power(on: boolean): Promise<Completion> {
    try {
      if (!on) this.#monitor.interrupt();
      return deviceCompletion(await this.#player.setScreen(on), 'display');
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /** Sets the status view's filter and cadence (`pixoo-monitor-set`): presentation state saved before the completion. */
  async view(action: ViewChange): Promise<Completion> {
    try {
      await this.#monitor.configure(action);
      return OBSERVED;
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /**
   * Takes a Hub mode (`device-mode-set`, ADR 0014). The mode is saved first, as policy only; then Work stops a held item,
   * entering Quiet remembers the brightness last requested and writes the Quiet level, and leaving Quiet writes the
   * remembered brightness once. A Quiet command in Quiet writes the Quiet level again, so a brightness set meanwhile lasts
   * until the next mode command; Work and Free write no brightness of their own. A command that writes nothing completes
   * `observed`; one that writes brightness completes as that write, never retried. An uncertain write keeps the saved
   * mode, so the next mode command writes fresh.
   */
  async mode(mode: HubMode): Promise<Completion> {
    const previous = this.#monitor.currentMode();
    try {
      await this.#monitor.setMode(mode);
    } catch (error) {
      return errorCompletion(error);
    }
    const quiet = this.#quiet;
    if (quiet === undefined) return OBSERVED;
    let percent: number | undefined;
    if (mode === 'quiet') {
      if (previous !== 'quiet') {
        const evidence = this.#player.getDisplayEvidence();
        quiet.remember(evidence.requestedBrightness ?? evidence.brightness.observed?.value);
      }
      percent = quiet.level;
    } else if (previous === 'quiet') {
      // The remembered value is forgotten once Quiet is left, whatever its write does: the next mode command writes fresh.
      percent = quiet.remembered();
      quiet.remember(undefined);
    }
    return percent === undefined ? OBSERVED : this.brightness(percent);
  }

  /** Sets what Now Playing does over the playback base (`pixoo-now-playing-set`), saved before the completion. */
  async nowPlaying(media: NowPlayingMedia): Promise<Completion> {
    try {
      await this.#monitor.setNowPlaying(media);
      return OBSERVED;
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /** Sets whether moments may cover the status base (`pixoo-moments-set`), saved before the completion. */
  async moments(overStatus: boolean): Promise<Completion> {
    try {
      await this.#monitor.setMoments(overStatus);
      return OBSERVED;
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /**
   * Plays one moment (`moment-play`). It completes after the moment ended and its base came back. A moment that reached
   * the device succeeds with its transmission, however it ended, and carries its ending. One that never did has no ending:
   * a failed write completes as that write, and otherwise nothing was sent.
   */
  async moment(play: MomentPlay): Promise<Completion> {
    const result = await this.#monitor.playMoment(play);
    if (result.ending !== null) return {...deviceCompletion(result.upload, 'moment'), ended: {ending: result.ending, endedAtMs: result.endedAtMs}};
    switch (result.refused) {
      case 'expired': return failed('expired', 'the moment missed its start window');
      case 'blocked': return failed('invalid-state', 'the current presentation no longer admits the moment');
      case 'notice': return failed('invalid-state', 'rain forecast evidence cannot cover this presentation');
      case 'cancelled': return failed('cancelled', 'a newer request or attention ended the moment before it was sent');
      case 'unknown': return uncertain('the moment\'s write failed after it began');
      case 'content': return failed('internal', 'the moment could not be drawn');
      case 'upload': return deviceCompletion(result.upload, 'moment');
    }
  }

  /** One playlist change (`pixoo-playlist-change`), committed by the library before the completion. */
  async playlist(change: PlaylistChange): Promise<Completion> {
    const library = this.#library;
    if (library === undefined) return failed('unavailable', 'the library is not open');
    try {
      switch (change.operation) {
        case 'create': await library.createPlaylist(change.name, options(change), {playlistId:change.playlistId,items:change.items}); break;
        case 'rename': await library.renamePlaylist(change.playlistId, change.revision, change.name); break;
        case 'options': await library.setPlaylistOptions(change.playlistId, change.revision, options(change)); break;
        case 'items': await library.replaceItems(change.playlistId, change.revision, change.items); break;
        case 'order': await library.reorderItems(change.playlistId, change.revision, change.itemIds); break;
        case 'duplicate': await library.duplicatePlaylist(change.playlistId, change.revision, change.name); break;
        case 'delete': await library.deletePlaylist(change.playlistId, change.revision); break;
      }
      return OBSERVED;
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /**
   * One media change (`pixoo-asset-change`). An import or a new rendition decodes in the media child process, under its
   * heap cap, so a corrupt or oversized image fails only its own job; the library commits the result before the
   * completion. Imports preserve source timing. Playback checks the selected command.
   */
  async asset(change: AssetChange, signal?: AbortSignal): Promise<Completion> {
    const library = this.#library;
    if (library === undefined) return failed('unavailable', 'the library is not open');
    try {
      switch (change.operation) {
        case 'import': {
          const {bytes} = change;
          const source = async function* (): AsyncGenerator<Uint8Array> { yield await Promise.resolve(bytes); };
          await library.importMedia(source(), change.name, signal === undefined ? {} : {signal});
          break;
        }
        case 'render':
          await library.renderAsset(change.assetId, {...(change.transform === undefined ? {} : {transform: change.transform}), ...(signal === undefined ? {} : {signal})});
          break;
        case 'delete': await library.deleteAsset(change.assetId); break;
      }
      return OBSERVED;
    } catch (error) {
      return errorCompletion(error);
    }
  }

  /** The active profile, for callers that check a rendition's compatibility. */
  get profile(): Readonly<MediaProfile> | undefined {
    return this.#profile;
  }

  /**
   * Stops following the player. A command still waiting for its upload never completes: the upload may have been sent,
   * so the module's next start reports the command uncertain from its stored record, and nothing invents a result.
   */
  close(): void {
    this.#unsubscribe();
    this.#tracked.clear();
  }

  #observe(event: MediaOperationEvent): void {
    if (event.phase === 'pending') {
      const command = this.#commands.getStore();
      if (command === undefined || this.#launched.has(command)) return;
      this.#launched.set(command, event.operationId);
      this.#tracked.set(event.operationId, {generation: event.generation});
      return;
    }
    const entry = this.#tracked.get(event.operationId);
    if (entry === undefined) return;
    if (entry.resolve === undefined) {
      entry.result = event.result;
      return;
    }
    this.#tracked.delete(event.operationId);
    entry.resolve(event.result);
  }

  /**
   * Runs a player action through the presentation, as ControlService did: one that starts playback takes the display
   * from the status base, and any other interrupts it at once, which cancels a pending start. When the action
   * launched an upload for its own player generation, the completion is that upload's; otherwise the action changed only
   * the module's playback state, which it saved, and the completion is observed.
   *
   * A Now Playing takeover is the exception. While a song plays and Now Playing wants a whole takeover, a start pauses for the
   * card at once, rather than at the next tick, so its first picture never flashes. When the takeover's pause cancels the
   * upload, the selection the command committed stands and plays once the song ends, so the command completes
   * `observed`: its committed state is the evidence. An upload that a newer command cancelled stays `cancelled`.
   */
  async #playback(action: () => Promise<void>, starts: boolean): Promise<Completion> {
    const command = {};
    try {
      await this.#commands.run(command, () => this.#monitor.media(action, starts));
    } catch (error) {
      return errorCompletion(error);
    }
    if (starts) this.#monitor.takeOverNow();
    const operationId = this.#launched.get(command);
    const entry = operationId === undefined ? undefined : this.#tracked.get(operationId);
    if (operationId === undefined || entry === undefined) return OBSERVED;
    let {result} = entry;
    if (result === undefined) result = await new Promise<OperationResult<unknown>>(resolve => { entry.resolve = resolve; });
    else this.#tracked.delete(operationId);
    if (!result.ok && (result.code === 'cancelled' || result.code === 'stale-generation')) {
      // The pause cancels the upload before the takeover records itself, so the presentation's queue settles first.
      await this.#monitor.settled();
      if (this.#monitor.heldBack(entry.generation)) return OBSERVED;
    }
    return deviceCompletion(result, 'media');
  }
}

function options(change: {repeat?: boolean; shuffle?: boolean}): {repeat?: boolean; shuffle?: boolean} {
  return {...(change.repeat === undefined ? {} : {repeat: change.repeat}), ...(change.shuffle === undefined ? {} : {shuffle: change.shuffle})};
}
