// The checked-in classification of every state family of the core and of every shipped and simulated module (Hub
// #1771), by family and version: the bookkeeping members history may ignore (#1772). An empty list is a deliberate
// answer: every member of that family counts. A new state family or version fails `bookkeeping.test.ts` until it is
// listed here, and an entry must equal what the contracts package or the module's registration declares.
//
// The non-empty lists follow #1768: the device, power-limit and playback times; the Pixoo page and paint time (owner
// decision 3, 2026-11-12); and the Roborock and LIFX reading times the history replay found moving alone. Agent session
// times stay rows (decision 6). Hibernated modules (BB-8, ONN) are not built or registered, so they are not listed;
// one that returns fails the test until its families are classified.

const DEVICE = ['/observed/observedAtMs', '/lastTransmission/transmittedAtMs', '/externalControl/observedAtMs'] as const;

/** Every state family and version, with its bookkeeping members. */
export const STATE_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  // The contracts package's families, published by the core or by modules.
  'device/2.0': DEVICE, 'device/2.1': DEVICE, 'device/2.2': DEVICE, 'device/2.3': DEVICE, 'device/2.4': DEVICE,
  'power-limit/2.0': ['/observedAtMs', '/updatedAtMs'],
  'playback/2.0': ['/observedAtMs'], 'playback/2.1': ['/observedAtMs'],
  'session/2.0': [], 'session/2.1': [],
  'mode/2.0': [], 'mode/2.1': [],
  'inbox-item/2.0': [], 'inbox-item/2.1': [],
  'operation/2.0': [],
  'preference-state/2.0': [],
  'companion-state/2.0': [],
  'companion-speech-state/2.0': [],
  'coding-state/2.0': [], 'coding-state/2.1': [],
  'music-capture-state/2.0': [], 'music-capture-state/2.1': [], 'music-capture-state/2.2': [],
  'music-lighting-state/2.0': [],
  'music-lighting-device/2.0': [],
  'playback-position/2.0': [],
  'art-schedule/2.0': [],
  'assistant-state/2.0': [],
  'lighting-layout/2.0': [],
  'playback-layout/2.0': [],
  'home-layout/2.0': [], 'home-layout/2.1': [], 'home-layout/2.2': [],
  'art/2.0': [], 'art/2.1': [],
  // Each module's own families.
  'lifx-light/2.0': ['/observed/observedAtMs'],
  'pixoo-display/2.0': ['/monitor/page'], 'pixoo-display/2.1': ['/monitor/page'],
  'pixoo-rendition/2.0': [], 'pixoo-rendition/2.1': [],
  'pixoo-playlist/2.0': [],
  'roborock-vacuum/2.0': ['/observedAtMs/value'],
  'microduck-state/2.0': [],
  'reachy-state/2.0': [],
  'nanoleaf-wall/2.0': [],
  'nanoleaf-animations/2.0': [],
  'nanoleaf-reactive-presets/2.0': [],
  'nanoleaf-shows/2.0': [],
  'volcano-status/2.0': [],
  'weather-state/2.0': [],
};

/** Each module's own families that are not state: commands and occurrences, so that a new one is classified too. */
export const OTHER_MODULE_FAMILIES: readonly string[] = [
  'lifx-color-set/2.0', 'lifx-temperature-set/2.0',
  'microduck-gesture/2.0', 'microduck-stop/2.0', 'microduck-control/2.0', 'microduck-auto/2.0',
  'nanoleaf-reactive-preset-save/2.0', 'nanoleaf-show-save/2.0', 'nanoleaf-wall-edit/2.0', 'nanoleaf-machine-edit/2.0',
  'nanoleaf-animation-play/2.0', 'nanoleaf-favorite-edit/2.0', 'nanoleaf-notice-acknowledge/2.0',
  'pixoo-media-show/2.0', 'pixoo-monitor-set/2.0', 'pixoo-now-playing-set/2.0', 'pixoo-moments-set/2.0', 'pixoo-playlist-change/2.0',
  'pixoo-asset-change/2.0', 'pixoo-notice-dismiss/2.0',
  'reachy-gesture/2.0', 'reachy-stop/2.0', 'reachy-control/2.0', 'reachy-auto/2.0',
  'volcano-session-gap/2.0',
  'weather-changed/2.0',
  'wemo-hold-release/2.0',
];
