import {randomUUID} from 'node:crypto';
import {connectRemote, type Command, type RemoteEndpoint} from '@jimmie-potts/sdk';
import {MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureProgress, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture-data';

/** Numeric source fixture over the real gateway. It loads no native helper or media API. */
export async function musicCaptureProducer(url: string, token: string, microphoneId?: string) {
  const edge = await connectRemote({url, token, source: MUSIC_PRODUCER_SOURCE});
  const commands: Command<CaptureWork>[] = [];
  let endpoint: RemoteEndpoint, current: Command<CaptureWork> | undefined, sequence = 0, level = 0.25, automatic = true;
  let timer: ReturnType<typeof setInterval> | undefined, closed = false, refuse = false;
  let sourceMono = 0, sourceWall = 0;
  const progress = (command: Command<CaptureWork>, status: 'started' | 'stopped' | 'failed') => endpoint.publish<CaptureProgress>('music-capture-progress', {
    kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed', dataschema: 'https://bunny.invalid/events/music-capture-progress/2.0',
    data: {operationId: command.data.operationId, generation: command.data.generation,
      ...(status === 'failed' ? {status, error: {code: 'unavailable', retryable: true}} : {status})},
  }, {parent: command});
  const emit = async (overrides: Partial<Omit<CaptureFeatures, 'input' | 'microphoneId'>> = {}): Promise<void> => {
    if (current === undefined || current.data.action !== 'start') return;
    const selection = current.data.input === 'music' ? {input: 'music'} as const : {input: 'microphone', microphoneId: current.data.microphoneId} as const;
    const observedAtMs = sourceWall + sequence * 100, mono = sourceMono + sequence * 100;
    await endpoint.publish<CaptureFeatures>('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
      dataschema: `https://bunny.invalid/events/music-capture-features/${selection.input === 'music' ? '2.0' : '2.1'}`, data: {
        generation: current.data.generation, ...selection, sequence: ++sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
        startMonotonicMs: mono - 100, endMonotonicMs: mono, emittedMonotonicMs: mono, observedAtMs, validUntilMs: observedAtMs + 400,
        rms: level, peak: level, clippedFraction: 0, bands: {bass: level, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...overrides,
      }}, {parent: current});
  };
  const pause = (): void => {if (timer !== undefined) clearInterval(timer); timer = undefined;};
  const start = async (): Promise<void> => {
    if (current === undefined) return;
    sourceMono = performance.now() - sequence * 100;sourceWall = Date.now() - sequence * 100;
    await progress(current, 'started'); await emit(); pause();
    timer = setInterval(() => {void emit().catch(() => {pause();});}, 100);
  };
  endpoint = await edge.openEndpoint<CaptureWork>({family: 'music-capture-work', onClosed: pause, respond: command => {
    commands.push(command);
    if (command.data.action === 'start') {
      current = command; sequence = 0;
      if (refuse) queueMicrotask(() => {void progress(command, 'failed').catch(() => {});});
      else if (automatic) queueMicrotask(() => {void start().catch(() => {pause();});});
    } else {pause(); queueMicrotask(() => {void progress(command, 'stopped').catch(() => {});});}
    return {status: 'accepted'};
  }});
  const requestId = randomUUID();
  await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested',
    dataschema: `https://bunny.invalid/events/music-capture-endpoint/${microphoneId === undefined ? '2.0' : '2.1'}`,
    data: {requestId, action: 'enable', input: 'music', ...(microphoneId === undefined ? {} : {microphone: {id: microphoneId}})}}, {requestId, timeoutMs: 5000});
  return {commands, endpointId: endpoint.id, emit, pause, start,
    automatic(value: boolean) {automatic = value;}, level(value: number) {level = value;},
    refuse(value: boolean) {refuse = value;},
    async close() {if (closed) return; closed = true; pause(); await endpoint.close(); await edge.close();}};
}
