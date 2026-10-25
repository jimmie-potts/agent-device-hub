export type QualifiedVoice = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI'>;
export type SpeechInput = {text: string; voice: SpeechSynthesisVoice; volume: number; rate: number; pitch: number};
export type SpeechCallbacks = {start(): void; end(): void; error(code: string): void};
export type SpeechPort = {
  getVoices(): readonly SpeechSynthesisVoice[];
  voicesChanged(callback: () => void): () => void;
  speak(input: SpeechInput, callbacks: SpeechCallbacks): void;
  cancel(): void;
  readonly speaking: boolean;
  readonly pending: boolean;
};
export type SpeechResult =
  | {kind: 'not-started'; reason: 'disabled' | 'unavailable' | 'busy' | 'expired' | 'policy' | 'stopped' | 'invalid-input'}
  | {kind: 'completed'; started: true}
  | {kind: 'stopped'; started: boolean}
  | {kind: 'failed'; started: false}
  | {kind: 'uncertain'; started: boolean};
type Timing = {now(): number; after(ms: number, callback: () => void): () => void};
type Attempt = {
  controller: AbortController;
  stage: {kind: 'discovering'} | {kind: 'submitted'; started: boolean; stopping: boolean};
  done: Promise<SpeechResult>;
  resolve(result: SpeechResult): void;
  deadline: () => void;
  cancellation: () => void;
};
const timing: Timing = {now: () => Date.now(), after: (ms, callback) => {
  const timer = setTimeout(callback, ms); return () => {clearTimeout(timer);};
}};
const nothing = (): void => {};
const VOICE_WAIT_MS = 5_000;
const PLAYBACK_MS = 15_000;
const CANCELLATION_MS = 500;
const NO_EFFECT_ERRORS = new Set(['not-allowed', 'voice-unavailable', 'language-unavailable', 'invalid-argument', 'text-too-long', 'synthesis-unavailable']);

/** One live browser output. The module owns admission and queues; this driver never retries or queues speech. */
export class SpeechDriver {
  readonly #port: SpeechPort;
  readonly #voice: QualifiedVoice;
  readonly #time: Timing;
  #enabled = false;
  #closed = false;
  #uncertain = false;
  #qualification: AbortController | undefined;
  #attempt: Attempt | undefined;

  constructor(options: {port: SpeechPort; voice: QualifiedVoice; timing?: Timing}) {
    this.#port = options.port;
    this.#voice = {name: options.voice.name, lang: options.voice.lang, voiceURI: options.voice.voiceURI};
    this.#time = options.timing ?? timing;
  }
  get enabled(): boolean {return this.#enabled;}
  get active(): boolean {return this.#attempt !== undefined;}

  async enable(): Promise<boolean> {
    if (this.#closed || this.#uncertain || this.active) return false;
    this.#qualification?.abort(); this.#enabled = false;
    const controller = new AbortController(); this.#qualification = controller;
    const voice = await this.#voiceWithin(VOICE_WAIT_MS, controller.signal);
    if (this.#qualification !== controller) return false;
    this.#qualification = undefined;
    this.#enabled = voice !== undefined && !controller.signal.aborted && !this.#closed && !this.#uncertain;
    return this.#enabled;
  }

  play(request: {text: string; expiresAtMs: number; eligible: () => boolean}): Promise<SpeechResult> {
    if (this.#closed || this.#uncertain) return Promise.resolve({kind: 'not-started', reason: 'unavailable'});
    if (!this.#enabled) return Promise.resolve({kind: 'not-started', reason: 'disabled'});
    if (this.active) return Promise.resolve({kind: 'not-started', reason: 'busy'});
    if (!Number.isFinite(request.expiresAtMs) || request.text.trim() === '' || request.text.length > 512) {
      return Promise.resolve({kind: 'not-started', reason: 'invalid-input'});
    }
    let resolve: (result: SpeechResult) => void = nothing;
    const done = new Promise<SpeechResult>(settle => {resolve = settle;});
    const attempt: Attempt = {controller: new AbortController(), stage: {kind: 'discovering'}, done, resolve, deadline: nothing, cancellation: nothing};
    this.#attempt = attempt;
    void this.#prepare(attempt, {...request}).catch(() => {
      if (attempt.stage.kind === 'submitted') this.#uncertainOutput(attempt);
      else this.#finish(attempt, {kind: 'not-started', reason: 'unavailable'});
    });
    return done;
  }

  stop(): Promise<SpeechResult | undefined> {
    const attempt = this.#attempt;
    if (attempt === undefined) return Promise.resolve(undefined);
    if (attempt.stage.kind === 'discovering') this.#finish(attempt, {kind: 'not-started', reason: 'stopped'});
    else if (!attempt.stage.stopping) {
      attempt.stage.stopping = true;
      attempt.cancellation = this.#time.after(CANCELLATION_MS, () => {this.#uncertainOutput(attempt, false);});
      try {this.#port.cancel();} catch {this.#uncertainOutput(attempt, false);}
    }
    return attempt.done;
  }

  mute(): Promise<SpeechResult | undefined> {
    this.#enabled = false; this.#qualification?.abort(); this.#qualification = undefined;
    return this.stop();
  }

  close(): Promise<SpeechResult | undefined> {this.#closed = true; return this.mute();}

  #findVoice(): SpeechSynthesisVoice | undefined {
    if (!/^en(?:-|$)/i.test(this.#voice.lang)) return undefined;
    const matches = this.#port.getVoices().filter(voice => voice.localService && voice.name === this.#voice.name
      && voice.lang === this.#voice.lang && voice.voiceURI === this.#voice.voiceURI);
    return matches.length === 1 ? matches[0] : undefined;
  }

  #voiceWithin(ms: number, signal: AbortSignal): Promise<SpeechSynthesisVoice | undefined> {
    return new Promise(resolve => {
      let settled = false, cancel = nothing, unlisten = nothing;
      const finish = (voice: SpeechSynthesisVoice | undefined): void => {
        if (settled) return;
        settled = true; cancel(); unlisten(); signal.removeEventListener('abort', aborted); resolve(voice);
      };
      const aborted = (): void => {finish(undefined);};
      const inspect = (): void => {
        try {const voice = this.#findVoice(); if (voice !== undefined) finish(voice);} catch {finish(undefined);}
      };
      if (signal.aborted || ms <= 0) {finish(undefined); return;}
      inspect(); if (settled) return;
      signal.addEventListener('abort', aborted, {once: true});
      cancel = this.#time.after(ms, aborted);
      try {unlisten = this.#port.voicesChanged(inspect);} catch {finish(undefined);}
      if (settled) unlisten(); else inspect();
    });
  }

  async #prepare(attempt: Attempt, request: {text: string; expiresAtMs: number; eligible: () => boolean}): Promise<void> {
    const remaining = request.expiresAtMs - this.#time.now();
    if (remaining <= 0) {this.#finish(attempt, {kind: 'not-started', reason: 'expired'}); return;}
    if (!request.eligible()) {this.#finish(attempt, {kind: 'not-started', reason: 'policy'}); return;}
    const voice = await this.#voiceWithin(Math.min(VOICE_WAIT_MS, remaining), attempt.controller.signal);
    if (this.#attempt !== attempt) return;
    if (request.expiresAtMs <= this.#time.now()) {this.#finish(attempt, {kind: 'not-started', reason: 'expired'}); return;}
    if (!this.#enabled || !request.eligible()) {this.#finish(attempt, {kind: 'not-started', reason: 'policy'}); return;}
    const currentVoice = this.#findVoice();
    if (voice === undefined || currentVoice === undefined) {
      this.#enabled = false; this.#finish(attempt, {kind: 'not-started', reason: 'unavailable'}); return;
    }
    if (this.#port.speaking || this.#port.pending) {this.#finish(attempt, {kind: 'not-started', reason: 'busy'}); return;}
    attempt.stage = {kind: 'submitted', started: false, stopping: false};
    attempt.deadline = this.#time.after(Math.min(PLAYBACK_MS, request.expiresAtMs - this.#time.now()), () => {this.#uncertainOutput(attempt);});
    this.#port.speak({text: request.text, voice: currentVoice, volume: 0.65, rate: 1, pitch: 1}, {
      start: () => {
        if (this.#attempt === attempt && attempt.stage.kind === 'submitted') attempt.stage.started = true;
      },
      end: () => {this.#terminal(attempt);},
      error: code => {this.#terminal(attempt, code);},
    });
  }

  #terminal(attempt: Attempt, error?: string): void {
    if (this.#attempt !== attempt || attempt.stage.kind !== 'submitted') return;
    const {started, stopping} = attempt.stage;
    if (this.#port.speaking || this.#port.pending) {this.#uncertainOutput(attempt); return;}
    if (stopping && (error === undefined || error === 'interrupted' || error === 'canceled')) {
      this.#finish(attempt, {kind: 'stopped', started});
    } else if (error === undefined && started) this.#finish(attempt, {kind: 'completed', started});
    else if (!started && error !== undefined && NO_EFFECT_ERRORS.has(error)) {
      this.#enabled = false; this.#finish(attempt, {kind: 'failed', started: false});
    } else this.#uncertainOutput(attempt);
  }

  #uncertainOutput(attempt: Attempt, cancel = true): void {
    if (this.#attempt !== attempt) return;
    const started = attempt.stage.kind === 'submitted' && attempt.stage.started;
    this.#uncertain = true; this.#enabled = false;
    this.#finish(attempt, {kind: 'uncertain', started});
    if (cancel) {try {this.#port.cancel();} catch { /* The uncertain result already includes failed cancellation. */ }}
  }

  #finish(attempt: Attempt, result: SpeechResult): void {
    if (this.#attempt !== attempt) return;
    this.#attempt = undefined; attempt.deadline(); attempt.cancellation(); attempt.controller.abort(); attempt.resolve(result);
  }
}

/** This adapter only enumerates until the driver receives an explicitly authorized play request. */
export function browserSpeechPort(): SpeechPort | undefined {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return undefined;
  const synth = window.speechSynthesis;
  return {
    getVoices: () => synth.getVoices(),
    voicesChanged: callback => {synth.addEventListener('voiceschanged', callback); return () => {synth.removeEventListener('voiceschanged', callback);};},
    get speaking() {return synth.speaking;},
    get pending() {return synth.pending;},
    cancel: () => {synth.cancel();},
    speak: (input, callbacks) => {
      const utterance = new SpeechSynthesisUtterance(input.text);
      utterance.voice = input.voice; utterance.lang = input.voice.lang; utterance.volume = input.volume; utterance.rate = input.rate; utterance.pitch = input.pitch;
      utterance.onstart = () => {callbacks.start();}; utterance.onend = () => {callbacks.end();}; utterance.onerror = event => {callbacks.error(event.error);};
      synth.speak(utterance);
    },
  };
}
