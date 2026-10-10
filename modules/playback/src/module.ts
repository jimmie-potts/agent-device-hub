// The playback module (Hub #929): one owner for the Sony HT-A9 and the Sonos Move, because the presented-source rule
// (#233) needs both sources and modules cannot import each other. It polls each configured speaker about every two
// seconds, publishes the presented source as the core `playback` record (`playback/2.1`), and answers `playback-control`
// with a reply and an outcome from its outbox. Under policy A (ADR 0012, "Failure isolation") a speaker's errors and
// timeouts are outcomes and an `unavailable` record, never a module failure, and start never waits on a speaker.
import {SCHEMA_BASE, errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import type {PlaybackControlRequest, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {
  DeviceAvailability, fullDisk, Outbox, SdkError, type BunnyModule, type Cancel, type Command, type CommandDraft, type LogFields, type Reply, type StateDraft,
  type TraceContext,
} from '@jimmie-potts/sdk';
import {configurePlayback, type PlaybackConfig} from './configuration.js';
import {Presentation, isAction, type PlaybackAction, type PresentedView} from './playback.js';
import {createSimulatedArtworkFetch} from './simulated-artwork.js';
import {SIMULATED_SECTION, SimulatedSpeakers} from './simulated.js';
import {createSource, type Deadline} from './sources.js';
import {httpSpeakers, type SpeakerTransport} from './transport.js';
import {ArtworkController} from './artwork.js';
import {ARTWORK_DECODE_MS, type ArtworkFetch, type ArtworkResult} from './artwork-fetch.js';
import type {ArtworkDecode, ArtworkThumbnail} from './artwork-decode.js';
import {readArtworkContent} from './artwork-content.js';

export const PLAYBACK_MODULE = 'playback';
export const PLAYBACK_SCHEMA = `${SCHEMA_BASE}playback/2.1`;
export const PLAYBACK_CONTROL_SCHEMA = `${SCHEMA_BASE}playback-control/2.0`;
const OUTCOME_SCHEMA = `${SCHEMA_BASE}outcome/2.0`;
/** How often each speaker is read, as the old Hub did. */
export const POLL_MS = 2000;
/** How long one call to a speaker may take: each read call and each command. */
export const CALL_TIMEOUT_MS = 1500;
/** How many handled commands the module remembers, so a repeated `requestId` is answered without sending it again. */
export const RETAINED = 64;
/** The first wait before an outcome the database refused is committed again; each later wait doubles, up to the last. */
export const OUTCOME_RETRY_MS = 1000;
export const OUTCOME_RETRY_MAX_MS = 60_000;
// The diagnostic contract's `bunny.device.id` pattern.
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PlaybackModuleOptions = {
  /** How the module reaches its speakers: `httpSpeakers()` for the real ones, `SimulatedSpeakers` in tests and runs. */
  transport: SpeakerTransport;
  /** How often each speaker is read. Defaults to `POLL_MS`. */
  pollMs?: number;
  /** How long one call to a speaker may take. Defaults to `CALL_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * A monotonic clock in milliseconds, so neither a wall-clock step back nor a suspend keeps old data fresh. Defaults to
   * `performance.now()`; a test on a manual clock passes that clock.
   */
  monotonic?: () => number;
  artwork?: {fetch?: ArtworkFetch; decode?: ArtworkDecode};
};

/** The routing key of the playback record's state messages. */
export const playbackKey = (id: string): string => `bunny.state.playback.${id}`;
/** A `playback-control` command for the playback record `id`. */
export const controlPlayback = (id: string, action: PlaybackAction, expectedRevision?: number):
{key: string; draft: CommandDraft<Omit<PlaybackControlRequest, 'requestId'>>} => ({
  key: `bunny.cmd.playback-control.${id}`,
  draft: {
    type: 'org.bunny.playback.control.requested', subject: id, dataschema: PLAYBACK_CONTROL_SCHEMA,
    data: {action, ...(expectedRevision === undefined ? {} : {expectedRevision})},
  },
});

const stateOf = (record: PlaybackState): StateDraft<PlaybackState> =>
  ({type: 'org.bunny.playback.updated', subject: record.id, dataschema: PLAYBACK_SCHEMA, data: structuredClone(record)});
/** What a revision says: availability, presented playback and current artwork. `observedAtMs` alone never makes a new revision. */
const content = (record: PlaybackState): string => JSON.stringify([record.availability, record.playback, record.artwork]);
/** The record for what is presented now. An unavailable source shows no playback, and old metadata is withheld. */
function recordOf(id: string, revision: number, {availability, observedAtMs, observation}: PresentedView): PlaybackState {
  const {title, artist, album} = observation ?? {};
  const playback: PlaybackState['playback'] = availability === 'unavailable' || observation === undefined ? {status: 'unknown'} : {
    status: 'known', player: observation.status, ...(title === undefined ? {} : {title}), ...(artist === undefined ? {} : {artist}),
    ...(album === undefined ? {} : {album}), controls: [...observation.controls],
  };
  return {id, revision, availability, ...(observedAtMs === undefined ? {} : {observedAtMs}), playback};
}
// SQLite's result codes, from a node:sqlite error's `errcode`.
const SQLITE_BUSY = 5, SQLITE_LOCKED = 6;
const errcode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode : undefined;
/** A database refusal's registry code: `capacity` for a full disk, `unavailable` for a database another writer holds. */
function storageCode(error: unknown): ErrorCode {
  if (error instanceof SdkError) return error.body.error.code;
  const code = errcode(error);
  return fullDisk(error) ? 'capacity' : code === SQLITE_BUSY || code === SQLITE_LOCKED ? 'unavailable' : 'internal';
}

type Handled = {body: string; result: string | null};

/**
 * The playback module. `configure` takes the playback record's routing ID and one or two speakers in preference order
 * (see `configurePlayback`); the runtime refuses the module without that section.
 */
export function createPlaybackModule({transport, pollMs = POLL_MS, timeoutMs = CALL_TIMEOUT_MS, monotonic = () => performance.now(), artwork: artworkOptions}: PlaybackModuleOptions):
BunnyModule<PlaybackConfig> {
  let readContent: NonNullable<BunnyModule<PlaybackConfig>['manifest']['content']> | undefined;
  return {
    manifest: {name: PLAYBACK_MODULE, apiVersion: '1.2', configure: configurePlayback, content: ref => readContent?.(ref)},
    async start({sdk, config, database, clock, scheduler, log, trace, signal, workers}) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (config === undefined) throw new Error('the playback module started without its configuration');
      readContent = undefined;
      const retireContent = (): void => { readContent = undefined; };
      signal.addEventListener('abort', retireContent, {once: true});
      const {id} = config;
      const db = database();
      db.exec(`CREATE TABLE IF NOT EXISTS playback_records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS playback_commands (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, request_id TEXT NOT NULL, body TEXT NOT NULL, result TEXT,
          UNIQUE (source, request_id)) STRICT`);
      const saveRevision = db.prepare('INSERT INTO playback_records (id, revision) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET revision = excluded.revision');
      const handled = db.prepare('SELECT body, result FROM playback_commands WHERE source = ? AND request_id = ?');
      const admit = db.prepare('INSERT INTO playback_commands (source, request_id, body) VALUES (?, ?, ?)');
      const finish = db.prepare('UPDATE playback_commands SET result = ? WHERE source = ? AND request_id = ?');
      const unfinished = db.prepare('SELECT seq, request_id FROM playback_commands WHERE result IS NULL ORDER BY seq');
      const abandon = db.prepare('UPDATE playback_commands SET result = \'uncertain\' WHERE seq = ?');
      const forget = db.prepare('DELETE FROM playback_commands WHERE result IS NOT NULL AND seq <= (SELECT MAX(seq) FROM playback_commands) - ?');
      const outbox = new Outbox({sdk, database: db, clock, log, trace});

      // What a crash kept from going out, and every outcome the core has not acknowledged, go out again. The outbox
      // follows the core's acknowledgments first (Hub #782), so it forgets each outcome the core recorded.
      const republished = await outbox.republish();
      log.info('outbox.republished', {'bunny.outbox.republished_count': republished});
      const outcomeKey = `bunny.event.playback-control.${id}`;
      const completed = (outcome: CompletedOutcome) => ({
        kind: 'outcome' as const, type: 'org.bunny.playback.control.completed', subject: id, dataschema: OUTCOME_SCHEMA, data: outcome,
      });
      // A command the module admitted before a crash, with no outcome yet, may have reached the speaker: it is reported
      // uncertain, and never sent again.
      const lost = unfinished.all() as {seq: number; request_id: string}[];
      if (lost.length > 0) {
        await outbox.transaction(add => {
          for (const {seq, request_id: requestId} of lost) {
            abandon.run(seq);
            add(outcomeKey, completed({
              requestId, result: 'uncertain', evidence: 'none',
              error: errorBody('uncertain-result', {detail: 'the module restarted before the speaker answered'}).error,
            }));
          }
        });
      }

      const presentation = new Presentation(config.sources.length, () => clock.now(), monotonic);
      const deadline: Deadline = async call => {
        const timer = new AbortController();
        const cancel = scheduler.after(timeoutMs, () => { timer.abort(); });
        try {
          return await call(AbortSignal.any([timer.signal, signal]));
        } finally {
          cancel();
        }
      };
      const sources = config.sources.map(source => createSource(source, transport, deadline));
      // A source has no ID of its own; its records name it by the playback ID and its kind, never by its address.
      const devices = sources.map(source => `${id}.${source.kind}`);
      const deviceField = (device: string): LogFields => DEVICE_ID.test(device) ? {'bunny.device.id': device} : {};
      const reach = new DeviceAvailability({log, clock});

      // Every commit shares one run of database refusals: one record when they start, and one when a commit works again.
      let storageFailing = false;
      const storageFailed = (error: unknown, fields: LogFields = {}, parent?: TraceContext): void => {
        if (storageFailing) return;
        storageFailing = true;
        const code = storageCode(error);
        log[code === 'internal' ? 'error' : 'warn']('operation.failed', {'bunny.operation': 'storage', 'bunny.code': code, ...fields}, parent);
      };
      const storageWorked = (): void => {
        if (!storageFailing) return;
        storageFailing = false;
        log.info('operation.completed', {'bunny.operation': 'storage', 'bunny.outcome': 'succeeded'});
      };

      // The optimistic record drives existing revision admission/rollback; content uses only successful commits.
      const stored = db.prepare('SELECT revision FROM playback_records WHERE id = ?').get(id) as {revision: number} | undefined;
      let record = recordOf(id, (stored?.revision ?? 0) + 1, presentation.view());
      let committedRecord: PlaybackState | undefined;
      /** Whether the last commit failed, so the next evaluation publishes whatever it finds. */
      let dirty = false;
      const commit = (next: PlaybackState): Promise<void> => {
        const previous = record;
        record = next;
        return outbox.transaction(add => {
          saveRevision.run(id, next.revision);
          add(playbackKey(id), {kind: 'state', ...stateOf(next)});
        }).then(() => {
          // Outbox resolves after its publish attempt; a committed deferred publish still stands.
          if (committedRecord === undefined || next.revision > committedRecord.revision) committedRecord = next;
          storageWorked();
        }, (error: unknown) => {
          // Nothing committed, and the next evaluation tries again.
          if (record === next) {
            record = previous;
            dirty = true;
          }
          storageFailed(error);
        });
      };
      await commit(record);

      /**
       * Whether each speaker's first read since this start has settled: answered, or failed at its deadline. Until all
       * have, nothing is presented, so a speaker that answers first never stands in for one still being read: after a
       * restart, an HT-A9 on another input would otherwise publish a record that says nothing plays while the Move does.
       */
      const firstRead = sources.map(() => false);
      const allFirstReadsSettled = (): boolean => firstRead.every(Boolean);
      let markSettled: () => void = () => {};
      const firstReads = new Promise<void>(resolve => { markSettled = resolve; });
      const artwork = new ArtworkController({scheduler, signal,
        ...(artworkOptions?.fetch === undefined ? {} : {fetch: artworkOptions.fetch}),
        decode: artworkOptions?.decode ?? ((bytes, abort) => workers.call<ArtworkResult<ArtworkThumbnail>>(
          new URL('./artwork-worker.js', import.meta.url), bytes, {timeoutMs: ARTWORK_DECODE_MS, signal: abort})),
        onChange: () => { evaluate(); },
        onDiagnostic: diagnostic => {
          const fields: LogFields = {'bunny.operation': 'media', 'bunny.code': diagnostic.code,
            'bunny.attempt_count': diagnostic.attempts, ...deviceField(`${id}.sony`)};
          if (diagnostic.kind === 'recovery') {
            log.info('operation.completed', {...fields, 'bunny.outcome': 'succeeded'});
          } else if (diagnostic.kind !== 'failure') {
            log.debug('operation.failed', fields);
          } else {
            const level = diagnostic.code === 'internal' ? 'error' :
              ['capacity', 'unavailable', 'uncertain-result', 'unauthenticated', 'forbidden', 'too-large', 'duplicate-conflict'].includes(diagnostic.code) ? 'warn' : 'info';
            log[level]('operation.failed', fields);
          }
        },
      });
      if (!signal.aborted) readContent = ref => {
        if (signal.aborted) return undefined;
        const view = presentation.view(), observation = view.observation;
        const playback = committedRecord?.playback;
        return readArtworkContent(ref, {
          record: committedRecord, current: artwork.snapshot(), stopped: signal.aborted,
          presentedSonyIsEligible: view.availability === 'available' && config.sources[view.index]?.kind === 'sony'
            && observation !== undefined && (observation.status === 'playing' || observation.status === 'paused'),
          presentedMetadataMatchesRecord: playback?.status === 'known' && observation !== undefined
            && playback.player === observation.status && playback.title === observation.title
            && playback.artist === observation.artist && playback.album === observation.album,
        });
      };
      /** Publishes a new revision when availability, presented playback or current artwork changes. */
      let freshness: (() => void) | undefined;
      const evaluate = (): void => {
        if (signal.aborted || !allFirstReadsSettled()) return;
        const view = presentation.view();
        const sourceConfig = config.sources[view.index];
        if (sourceConfig !== undefined) artwork.update({...view, kind: sourceConfig.kind, endpoint: sourceConfig.endpoint});
        const image = artwork.snapshot();
        const next = {...recordOf(id, record.revision + 1, view), ...(image === undefined ? {} : {artwork: image})};
        if (dirty || content(next) !== content(record)) {
          dirty = false;
          void commit(next);
        }
        // Wake when a source's last observation crosses the stale or unavailable threshold.
        freshness?.();
        freshness = undefined;
        const wait = presentation.nextChangeInMs();
        if (wait !== undefined) freshness = scheduler.after(Math.ceil(wait), evaluate);
      };

      // Each speaker is read now and then about every `pollMs`, without overlapping reads: a read still in progress when
      // the next is due is not repeated. Start does not wait for any of them (policy A).
      const inFlight: (Promise<void> | undefined)[] = sources.map(() => undefined);
      const read = async (index: number): Promise<void> => {
        const source = sources[index], device = devices[index];
        if (source === undefined || device === undefined) return;
        try {
          const observation = await source.read();
          if (signal.aborted) return;
          presentation.report(index, observation);
          reach.reached(device);
        } catch {
          if (signal.aborted) return;
          // A failed read reports nothing, so the observation ages; one record per outage, not one per poll.
          reach.unreachable(device, 'unavailable');
        }
        firstRead[index] = true;
        if (allFirstReadsSettled()) markSettled();
        evaluate();
      };
      /** The speaker's read in progress, or a new one. */
      const readNow = (index: number): Promise<void> => {
        const running = inFlight[index];
        if (running !== undefined) return running;
        const started = read(index).finally(() => { inFlight[index] = undefined; });
        inFlight[index] = started;
        return started;
      };
      /** A read that starts after this moment: after the read in progress, if there is one. */
      const readAfter = (index: number): Promise<void> => {
        const running = inFlight[index];
        return running === undefined ? readNow(index) : running.then(() => readNow(index));
      };
      const tick = (index: number): void => {
        if (signal.aborted) return;
        scheduler.after(pollMs, () => { tick(index); });
        void readNow(index);
      };

      /**
       * Waits for `pending`, at most one call's deadline, and no longer than the module runs. A stop cancels the module's
       * timers and refuses new ones, and a read the stop ends never marks its first read settled, so the stop itself
       * ends the wait; the caller then refuses its command as stopping.
       */
      const atMostOneCall = async (pending: Promise<void>): Promise<void> => {
        if (signal.aborted) return;
        let cancel: Cancel = () => {};
        let stopped: () => void = () => {};
        const late = new Promise<void>(resolve => {
          stopped = resolve;
          cancel = scheduler.after(timeoutMs, resolve);
        });
        signal.addEventListener('abort', stopped, {once: true});
        try {
          await Promise.race([pending, late]);
        } finally {
          signal.removeEventListener('abort', stopped);
          cancel();
        }
      };
      /**
       * The read of a speaker that follows its last command. The next command's admission waits for it, at most one call's
       * deadline, so a queued command is checked against what the speaker reports after the command ahead of it.
       */
      let settling: Promise<void> | undefined;
      const settled = async (): Promise<void> => {
        const pending = settling;
        settling = undefined;
        if (pending !== undefined) await atMostOneCall(pending);
      };

      /**
       * Commits a command's outcome with its result, then publishes it. While the database refuses, it tries again with
       * capped backoff; the stored intent keeps the command from being sent again, and if no retry commits before the
       * module stops, the next start reports the command uncertain. It never rejects.
       */
      const saveOutcome = async (command: Command<object>, requestId: string, outcome: CompletedOutcome, attempt = 0): Promise<void> => {
        try {
          await outbox.transaction(add => {
            finish.run(outcome.result, command.source, requestId);
            forget.run(RETAINED);
            add(outcomeKey, completed(outcome), {parent: command});
          });
          storageWorked();
        } catch (error) {
          storageFailed(error, {'bunny.request.id': requestId}, command);
          if (signal.aborted) return;
          scheduler.after(Math.min(OUTCOME_RETRY_MAX_MS, OUTCOME_RETRY_MS * 2 ** attempt), () => saveOutcome(command, requestId, outcome, attempt + 1));
        }
      };

      await sdk.serveSync(['playback'], () => ({revision: record.revision, states: [stateOf(record)]}));
      await sdk.respond<Omit<PlaybackControlRequest, 'requestId'>>(`bunny.cmd.playback-control.${id}`,
        async (command: Command<Omit<PlaybackControlRequest, 'requestId'>>): Promise<Reply> => {
          const {requestId, action, expectedRevision} = command.data as Partial<PlaybackControlRequest> & {requestId: string};
          if (command.subject !== id) return errorBody('invalid-request', {detail: 'the subject must be the playback record\'s id'});
          if (!isAction(action)) return errorBody('invalid-request', {detail: 'action must be play, pause, next or previous'});
          if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) {
            return errorBody('invalid-request', {detail: 'expectedRevision must be an integer'});
          }
          if (signal.aborted) return errorBody('unavailable', {detail: 'the playback module is stopping'});
          const body = JSON.stringify({action, expectedRevision: expectedRevision ?? null});
          const prior = handled.get(command.source, requestId) as Handled | undefined;
          if (prior !== undefined) {
            // The same request again is accepted and sends nothing: its outcome goes out once, from the outbox.
            if (prior.body === body) return {status: 'accepted'};
            return errorBody('duplicate-conflict', {detail: 'this requestId was used for another playback command'});
          }
          await settled();
          // A command right after the start waits for every speaker's first read, so it goes where the record will point.
          if (!allFirstReadsSettled()) await atMostOneCall(firstReads);
          if (signal.aborted) return errorBody('unavailable', {detail: 'the playback module is stopping'});
          // The SDK answered the requester `uncertain-result` if the deadline passed while the command waited for the read
          // ahead or the first reads. Nothing is sent then: the command is recorded as failed, and its outcome is the
          // definitive answer.
          const expiresAtMs = Date.parse(command.expiresat ?? '');
          if (Number.isFinite(expiresAtMs) && clock.now() >= expiresAtMs) {
            try {
              await outbox.transaction(() => { admit.run(command.source, requestId, body); });
              storageWorked();
            } catch (error) {
              storageFailed(error, {'bunny.request.id': requestId}, command);
              return errorBody('capacity', {detail: 'the playback module could not record the command'});
            }
            await saveOutcome(command, requestId, {
              requestId, result: 'failed', evidence: 'none',
              error: errorBody('expired', {detail: 'the command\'s deadline passed before it reached the speaker'}).error,
            });
            return {status: 'accepted'};
          }
          if (expectedRevision !== undefined && expectedRevision !== record.revision) {
            return errorBody('revision-conflict', {detail: 'the playback record has moved on; read it again'});
          }
          // Until every speaker's first read settles, the record is unavailable, and no source is presented.
          if (!allFirstReadsSettled()) return errorBody('unavailable', {detail: 'not every speaker has answered since the module started'});
          // The presented source is fixed here, at admission; a source that takes over meanwhile is never a redirect target.
          const index = presentation.presented();
          const source = sources[index], device = devices[index];
          if (source === undefined || device === undefined || presentation.availability(index) !== 'available') {
            return errorBody('unavailable', {detail: 'the presented speaker has not answered recently'});
          }
          if (!(presentation.observation(index)?.controls ?? []).includes(action)) {
            return errorBody('unsupported-capability', {detail: 'the presented speaker does not offer this action now'});
          }
          // The intent is stored before the speaker hears anything, so a crash never leaves a command to send again.
          try {
            await outbox.transaction(() => { admit.run(command.source, requestId, body); });
            storageWorked();
          } catch (error) {
            storageFailed(error, {...deviceField(device), 'bunny.request.id': requestId}, command);
            return errorBody('capacity', {detail: 'the playback module could not record the command'});
          }
          log.info('command.executing', {...deviceField(device), 'bunny.operation': 'playback', 'bunny.request.id': requestId}, command);
          // The speaker call has its own span, the command's child; the speaker gets no trace context.
          const call = trace.start('bunny.device.call', {
            parent: command, kind: 'client', attributes: {...deviceField(device), 'bunny.operation': 'playback', 'bunny.request.id': requestId},
          });
          let outcome: CompletedOutcome;
          try {
            // Sent once, and never retried. A speaker that answers with a refusal heard the command, so its evidence is
            // `transmitted`; no answer, or an answer that is neither, is uncertain.
            const sent = await source.command(action);
            switch (sent) {
              case 'sent':
                outcome = {requestId, result: 'succeeded', evidence: 'transmitted'};
                break;
              case 'refused':
                outcome = {requestId, result: 'failed', evidence: 'transmitted', error: errorBody('invalid-state', {detail: 'the speaker refused the action'}).error};
                break;
              case 'unsent':
                outcome = {requestId, result: 'failed', evidence: 'none', error: errorBody('unsupported-capability', {detail: 'the speaker has no command for this action'}).error};
                break;
            }
            call.end(sent === 'sent' ? 'unset' : 'error');
          } catch {
            outcome = {requestId, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result', {detail: 'the speaker did not answer the action'}).error};
            call.end('error');
          }
          // The reply follows the outcome's commit and publication. A database refusal never escapes: the outcome is
          // committed later, and the reply still says the module answers for it.
          await saveOutcome(command, requestId, outcome);
          if (!signal.aborted) settling = readAfter(index);
          return {status: 'accepted'};
        });

      sources.forEach((_, index) => { tick(index); });
    },
    stop: () => { readContent = undefined; },
  };
}

/**
 * The shipped list's factory: the real speakers over HTTP, or the simulated ones under `--simulate`, with the section
 * that configures the simulated build.
 */
export const playbackFactory = {
  name: PLAYBACK_MODULE,
  create: (): BunnyModule<PlaybackConfig> => createPlaybackModule({transport: httpSpeakers()}),
  simulate: (): BunnyModule<PlaybackConfig> => {
    const speakers = new SimulatedSpeakers();
    return createPlaybackModule({transport: speakers, artwork: {fetch: createSimulatedArtworkFetch(() => speakers.artworkAcquired())}});
  },
  // The speakers take no credential, so the section names no secret.
  simulatedSection: {config: SIMULATED_SECTION},
} as const;
