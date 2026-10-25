type SpeechFixture = {calls: number; cancelled: number; overlap: number; voices: boolean; finish(): void; releaseVoices(): void; fail(): void};
declare global {interface Window {speechFixture: SpeechFixture}}

/** Installs only synthetic browser identity and speech; it never submits native audio. */
export function installSyntheticSpeech(): void {
  Object.defineProperty(navigator, 'userAgentData', {value: {platform: 'macOS', getHighEntropyValues: () => Promise.resolve({fullVersionList: [{brand: 'Google Chrome', version: '150.0.0.1'}]})}});
  const NativeUtterance = SpeechSynthesisUtterance;
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {value: class extends NativeUtterance {
    constructor(text: string) {super(text); Object.defineProperty(this, 'voice', {value: null, writable: true});}
  }});
  const events = new EventTarget();
  const voice = {name: 'Synthetic local English', lang: 'en-US', voiceURI: 'synthetic-local', localService: true, default: true};
  let active: SpeechSynthesisUtterance | undefined;
  const fixture: SpeechFixture = {calls: 0, cancelled: 0, overlap: 0, voices: true,
    finish: () => {const utterance = active; active = undefined; if (utterance !== undefined) utterance.dispatchEvent(new SpeechSynthesisEvent('end', {utterance}));},
    releaseVoices: () => {fixture.voices = true; events.dispatchEvent(new Event('voiceschanged'));},
    fail: () => {const utterance = active; active = undefined; if (utterance !== undefined) utterance.dispatchEvent(new SpeechSynthesisErrorEvent('error', {utterance, error: 'synthesis-failed'}));},
  };
  window.speechFixture = fixture;
  Object.defineProperty(window, 'speechSynthesis', {value: {
    getVoices: () => fixture.voices ? [voice] : [],
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    get speaking() {return active !== undefined;}, get pending() {return false;},
    speak: (utterance: SpeechSynthesisUtterance) => {
      if (active !== undefined) fixture.overlap++; fixture.calls++; active = utterance;
      queueMicrotask(() => {if (active === utterance) utterance.dispatchEvent(new SpeechSynthesisEvent('start', {utterance}));});
    },
    cancel: () => {
      const utterance = active; active = undefined;
      if (utterance !== undefined) {fixture.cancelled++; utterance.dispatchEvent(new SpeechSynthesisErrorEvent('error', {utterance, error: 'interrupted'}));}
    },
  }});
}
