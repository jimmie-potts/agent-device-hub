## 1. Tests first

- [x] 1.1 Write `fixtures/v2/devices.json` and `tests/devices.test.mjs`: one valid message for every device family, a reply and an outcome for each command family, invalid cases pinned to their registry codes and details, the capability rule and the Hub-mode table per participating device kind. Evidence: red commit e04d6c65, where `tests/devices.test.mjs` fails because `dist/v2/devices.js` does not exist.
- [x] 1.2 Add the `notice-acknowledge` and `playback-control` fixtures and invalid cases to `fixtures/v2/families.json`, and drop the `lifecycle` acknowledgment fixture. Evidence: at e04d6c65 `tests/families.test.mjs` fails its valid and invalid fixture tests.
- [x] 1.3 Copy the 1.x status tests to `tests/status.test.mjs`, rewritten for `session/2.0` records, with the unsynced and acknowledging-consumer cases and a comparison with the 1.x helper. Evidence: at e04d6c65 `tests/status.test.mjs` fails because `dist/v2/status.js` does not exist.
- [x] 1.4 Extend `tests/mapping.test.mjs` to walk the controller snapshot, its capabilities, the request and the general command union, to convert the controller corpus, and to compare the capability rule with 1.x admission. Evidence: before MAPPING.md's sections, the mapping test fails naming each missing section.

## 2. Contracts

- [x] 2.1 Add the `device` and general command schemas, `src/v2/devices.ts` with `registerDeviceFamilies`, `commandSupported`, `HUB_MODE_TABLE` and `nativeMode`, held to the strict profile. Evidence: `tests/devices.test.mjs` passes.
- [x] 2.2 Add the `notice-acknowledge` and `playback-control` schemas to the core families and drop the `lifecycle` acknowledgment event. Evidence: `tests/families.test.mjs` passes.
- [x] 2.3 Copy `sessionState`, `highestStatus` and `STATUS_COLORS` into `src/v2/status.ts` with provenance notes, rewritten for `session/2.0` records. Evidence: `tests/status.test.mjs` passes.
- [x] 2.4 Write MAPPING.md's controller snapshot, general commands and agent status sections, and update its lifecycle rows. Evidence: `tests/mapping.test.mjs` passes.

## 3. Docs and checks

- [x] 3.1 Document the device families, the Hub-mode table and the status helper in the package README; export `./v2/devices` and `./v2/status`; update `docs/development.md` and `docs/architecture.md`.
- [x] 3.2 Run build, typecheck, `lint:js`, `test:events:built`, `test:events:python`, `test:sdk:built`, `test:runtime:built`, `test:workflow`, `check:workflow` and strict spec validation, with negative controls; then sync and archive this change. Evidence: every check exits zero, and fourteen negative controls each fail a named test.
