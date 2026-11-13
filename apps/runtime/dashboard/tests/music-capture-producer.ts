import {randomUUID} from 'node:crypto';
import {connectRemote, type Cancel, type Command, type RemoteEndpoint} from '@jimmie-potts/sdk';
import {CAPTURE_VALIDITY_MS, CAPTURE_WINDOW_MS, MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureProgress, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {WorldClock} from './world-clock.ts';

type ProducerClock = Pick<WorldClock, 'clock' | 'scheduler' | 'working'>;

/** Numeric source fixture over the real gateway. It loads no native helper or media API. */
export async function musicCaptureProducer(url: string, token: string, microphoneId?: string, clock?: ProducerClock) {
  const now = (): number => clock?.clock.now() ?? Date.now();
  const origin = now() - CAPTURE_WINDOW_MS;
  const monotonic = clock === undefined ? () => performance.now() : () => now() - origin;
  const edge = await connectRemote({url, token, source: MUSIC_PRODUCER_SOURCE,
    ...(clock === undefined ? {} : {now, scheduler: clock.scheduler})});
  const commands: Command<CaptureWork>[] = [];
  let endpoint: RemoteEndpoint, current: Command<CaptureWork> | undefined, sequence = 0, level = 0.25, automatic = true;
  let cancel: Cancel | undefined, run = 0, closed = false, refuse = false;
  let bands: CaptureFeatures['bands'] | undefined;
  let sourceMono = 0, sourceWall = 0;
  const progress = (command: Command<CaptureWork>, status: 'started' | 'stopped' | 'failed') => endpoint.publish<CaptureProgress>('music-capture-progress', {
    kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed', dataschema: 'https://bunny.invalid/events/music-capture-progress/2.0',
    data: {operationId: command.data.operationId, generation: command.data.generation,
      ...(status === 'failed' ? {status, error: {code: 'unavailable', retryable: true}} : {status})},
  }, {parent: command});
  const emit = async (overrides: Partial<Omit<CaptureFeatures, 'input' | 'microphoneId'>> = {}): Promise<void> => {
    if (current === undefined || current.data.action !== 'start') return;
    const selection = current.data.input === 'music' ? {input: 'music'} as const : {input: 'microphone', microphoneId: current.data.microphoneId} as const;
    const observedAtMs = sourceWall + sequence * CAPTURE_WINDOW_MS, mono = sourceMono + sequence * CAPTURE_WINDOW_MS;
    await endpoint.publish<CaptureFeatures>('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
      dataschema: `https://bunny.invalid/events/music-capture-features/${selection.input === 'music' ? '2.0' : '2.1'}`, data: {
        generation: current.data.generation, ...selection, sequence: ++sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
        startMonotonicMs: mono - CAPTURE_WINDOW_MS, endMonotonicMs: mono, emittedMonotonicMs: mono, observedAtMs, validUntilMs: observedAtMs + CAPTURE_VALIDITY_MS,
        rms: level, peak: level, clippedFraction: 0, bands: bands ?? {bass: level, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...overrides,
      }}, {parent: current});
  };
  const pause = (): void => {
    run += 1;
    cancel?.();
    cancel = undefined;
  };
  let draining = false;
  /**
   * Emits every 100 ms window that has ended by the real clock, as a capture producer delivers its backlog after a delay
   * (#1511). One frame per tick would let a late timer push the windows ever further behind real time, until the core
   * drops every frame as stale or retires the response clock.
   */
  const drain = async (started: number): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (started === run && sourceMono + sequence * CAPTURE_WINDOW_MS <= monotonic()) {
        const before = sequence; await emit();
        if (sequence === before) return;
      }
    } finally {draining = false;}
  };
  const schedule = (started: number): void => {
    if (clock === undefined) {
      const timer = setInterval(() => {void drain(started).catch(() => {if (started === run) pause();});}, CAPTURE_WINDOW_MS);
      cancel = () => clearInterval(timer);
      return;
    }
    const due = sourceMono + sequence * CAPTURE_WINDOW_MS;
    cancel = clock.scheduler.after(Math.max(0, due - monotonic()), () => {
      const publishing = drain(started).then(() => {
        if (started === run) schedule(started);
      }, () => {if (started === run) pause();});
      clock.working(publishing);
    });
  };
  const start = async (): Promise<void> => {
    if (closed || current === undefined) return;
    pause();
    const started = run;
    sourceMono = monotonic() - sequence * CAPTURE_WINDOW_MS;
    sourceWall = now() - sequence * CAPTURE_WINDOW_MS;
    await progress(current, 'started');
    if (started !== run) return;
    await emit();
    if (started === run) schedule(started);
  };
  endpoint = await edge.openEndpoint<CaptureWork>({family: 'music-capture-work', onClosed: pause, respond: command => {
    commands.push(command);
    if (command.data.action === 'start') {
      pause(); current = command; sequence = 0;
      if (refuse) queueMicrotask(() => {void progress(command, 'failed').catch(() => {});});
      else if (automatic) queueMicrotask(() => {
        if (current !== command) return;
        const publishing = start().catch(() => {if (current === command) pause();});
        clock?.working(publishing);
      });
    } else {pause(); queueMicrotask(() => {void progress(command, 'stopped').catch(() => {});});}
    return {status: 'accepted'};
  }});
  const requestId = randomUUID();
  await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested',
    dataschema: `https://bunny.invalid/events/music-capture-endpoint/${microphoneId === undefined ? '2.0' : '2.1'}`,
    data: {requestId, action: 'enable', input: 'music', ...(microphoneId === undefined ? {} : {microphone: {id: microphoneId}})}}, {requestId, timeoutMs: 5000});
  return {commands, endpointId: endpoint.id, emit, pause, start,
    automatic(value: boolean) {automatic = value;}, level(value: number) {level = value;},
    /** Sets explicit bass, mid and treble values; undefined returns to bass following the level. */
    bands(value: CaptureFeatures['bands'] | undefined) {bands = value;},
    refuse(value: boolean) {refuse = value;},
    async close() {if (closed) return; closed = true; pause(); await endpoint.close(); await edge.close();}};
}
