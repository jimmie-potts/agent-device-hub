// The checked-in classification of how every registered module publishes its state families (Hub #1772): for each
// module, the families it publishes on a poll with the polling interval its registration declares, the longest one
// when the interval changes with the device's state, and an empty entry for a module that publishes only when
// something happens. A module that is not listed, that starts or stops polling a family, or whose interval changes,
// fails `history-spans.test.ts` until this table matches its registration. History writes gap rows only for the
// families listed here (#1768, decision 4).

/** Each registered module's polled families and intervals in milliseconds. */
export const POLLING: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // Each plug is read `POLL_MS` (5 s) after its last read ends, and each answer publishes the device record with a new
  // reading time (modules/wemo/src/module.ts, `#schedule` and `#read`).
  'wemo': {device: 5000},
  // Each probe that answers comes back after `PROBE_MS` (30 s) and publishes the device record with a new reading time
  // (modules/pixoo/src/module/module.ts, `#probe`). The display record follows what is shown.
  'pixoo': {device: 30_000},
  // Each poll publishes the vacuum and device records, `ACTIVE_POLL_MS` (15 s) after the last reading while cleaning or
  // returning and `IDLE_POLL_MS` (60 s) otherwise (modules/roborock/src/collector.ts, `#schedule`; state.ts).
  'roborock': {'roborock-vacuum': 60_000, 'device': 60_000},
  // Each successful read, every `POLL_MS` (15 min), publishes a new record (modules/weather/src/module.ts, `#poll`).
  'weather': {'weather-state': 900_000},
  // Published only when something happens. LIFX reads a bulb on demand while its records are read; Nanoleaf's 5 s
  // reachability check, playback's 2 s speaker read and Tidbyt's tile loop publish only on a change or a transmission;
  // Volcano's device record follows availability; Codex Desktop's observations are not kept in history.
  'art': {}, 'codex-desktop': {}, 'companions': {}, 'lifx': {}, 'microduck': {}, 'nanoleaf': {}, 'playback': {}, 'reachy-mini': {},
  'tidbyt': {}, 'volcano': {}, 'wispr': {},
};
