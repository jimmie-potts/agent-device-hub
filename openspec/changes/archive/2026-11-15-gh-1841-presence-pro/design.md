## Context

See proposal.md and the accepted stock-interface guide. The runtime discovers
fixed module registrations, syncs module-owned families and records state in
core history. Stock reports have no sample clock or frame ID.

## Goals / Non-Goals

The module owns acquisition and projection; consumers own presentation. Keep
one bounded reconnect owner per sensor and persist only the ordinary SDK revision.
No live-state recovery, atomic-frame abstraction or new history platform is needed.

## Decisions

- Pin `@2colors/esphome-native-api` 1.3.7. Its exclusive configured Noise/plaintext
  transport and password support fit the security requirement. The evaluated
  `esphome-client` 2.1.0 permits plaintext fallback and has no password option.
- Bind typed numeric keys every connection and verify the exact MAC before
  subscribing. Source YAML IDs/display names are insufficient; modern API can
  omit object IDs. The adapter sends no setting/actuation commands or trace context.
- Keep a staged per-sensor projection during connection. Apply scalars in arrival
  order and promote on accepted connection, so initial inactive/reset transitions
  cannot be lost through key coalescing. Retired generations cannot write state.
- Five seconds bounds secret reads/connect/discovery; dispose before one capped
  retry timer. Independent sensors isolate failures. Firmware-cached initial state
  is reported state; receipt time never claims sample age.
- Keep module-local reusable schema/types and browser-safe contracts export. Core
  history/readers need no new API. Only supported numeric occupancy receipt
  bookkeeping is excluded; array/hold receipts remain ordinary history changes.
- Save calibration/settings references in the private normal configuration. Restart
  clears all live values. Stock X/Y is normalized once and planar yaw/translation
  gives approximate XZ; known masks, bad detail or missing settings inhibit points.

## Risks / Trade-offs

Stock silence can hide old cached values or internal failure; preserve last-report
times and uncertainty instead of inventing a TTL. History/publications may drop
observations; no replay is promised. Two pinned-client defects need small tested
per-instance shims: modern switch missing-state and late teardown errors. Actual
firmware compatibility, placement, useful precision and off-delays remain pilot
questions. All geometry/reports remain on existing private authenticated paths;
only synthetic evidence is committed. No device or service is changed by delivery.

## Migration Plan

Source only. Normal later runtime installation/enrollment remains #1842. The
new module revision table contains no restored observations or migrated data.
Downtime/lost observations are accepted; no backup/rollback ceremony is added.
