# Selected microphone source evidence

This is the bounded source increment for [#721](https://github.com/jimmie-potts/agent-device-hub/issues/721), initially reviewed against controls revision `34d638a0df86a7e478a59540dc8915b2bc529388`. It preserves the full issue's remaining calibration, tuning, richer analysis and installed/physical qualification. No real audio source, microphone enumeration, permission prompt, installed process or physical device was used.

## Behavioral evidence

- New contract examples first failed on the unregistered 2.1 endpoint schema. The five registered versions now accept selected microphone provenance and refuse private UID/extra fields, missing or oversized aliases, unsupported versions and microphone-shaped 2.0 records. Unchanged 2.0 fixtures still pass.
- The core test first exposed discarded microphone capability. It now covers explicit alias binding, refused alias or changed capability, one 2.1 sync/live state entity, wrong-input frames, current generation, stop fencing and retired configuration. Restart tests cover both microphone state and legacy Music responsibilities with no selection field, without replay.
- Configuration and producer tests first exposed rejected 1.1 configuration and missing registration capability. They now cover private-file protection, closed bounds, no helper on connection, private UID transfer through stdin only, fixed errors and correct feature versions. Real disposable child pipes and an authenticated SDK edge carry numeric-only fixtures for both selections, confirmed stop and stream loss.
- The native selected-microphone test first returned the existing usage error. The adapter now substitutes every CoreAudio call and AVFoundation authorization access. It verifies exact UID, unavailable UID, input-only IOProc stream usage/readback, no defaults or hardware setting changes, unsupported formats, permission refusal/revocation, removal/format change, source stop, partial acquisition and uncertain cleanup. Separate setup cases verify bounded private inventory, grant/denial, no capture, unanswered permission termination and simulated parent loss. Portable signal analysis is unchanged.
- The dashboard test exposed Music frames accepted during a microphone session. It now requires matching input and alias, accepts only registered state/feature versions and retains the existing conservative clock/freshness checks. The real disposable core/browser journey covers passive selection, refused microphone, explicit retry, reload without another start, confirmed stop and a return to 2.0 Music work.
- A valid 64-character alias initially widened a 320px page to 915px. The committed browser regression failed before the capture-card wrapping fix. It now passes before/during capture, with keyboard activation and axe. Synthetic screenshots were inspected at desktop and phone widths in both appearances; no private media is included. Existing shell navigation wrapping and skip-link presentation are outside this card change.

## Checks

Node 24.22.0 and the existing Python 3.14.8 environment were used. `npm ci` completed in the isolated worktree. Existing CI discovery covers all changed production and test files; no root manifest, lockfile or workflow changes were needed.

| Check | Result |
| --- | --- |
| `npm run build`, `npm run typecheck`, `npm run lint:js` | Passed. Build/lint repeated after the scoped CSS fix; browser test TypeScript checked after its regression addition. |
| `npm run test:events:built` | 239 passed. |
| `npm run test:events:python` | 4 passed on Python 3.14. |
| `npm run test:contracts:built`, `npm run test:contracts:python` | 410 Node and 4 Python tests passed. |
| `npm run test:package:built` | Passed with Python 3.14 and disposable npm package consumers. |
| `npm run test:music-producer:built` | 32 passed, including both real numeric-only child/SDK loopbacks. |
| Focused runtime capture and gateway suites | 22 passed on macOS. |
| Linux `npm run test:sdk:built`, `npm run test:music-producer:built` | 398 SDK and 32 producer tests passed. |
| Linux `npm run test:runtime:scenarios:built`, `npm run test:runtime:built` | 154 scenarios and 1,021 runtime tests passed; six runtime environment skips, zero failures. |
| `npm run test:runtime-dashboard:built` | 175 passed. Focused capture projection suite subsequently passed all 8 cases. |
| `npm run test:runtime-dashboard:browser` | Full suite passed on the source snapshot before the scoped card CSS fix. The entire Music/microphone browser journey passed again after that fix, including maximum alias, light/dark 1280/390/320px, keyboard, reduced motion and axe. |
| `npm run test:music-producer:native` | Portable synthetic analysis/concurrent transfer passed. |
| `npm run build:music-producer:native` | macOS source compilation passed; no capture executed. |
| `npm run test:music-producer:adapter` | All substituted Music/microphone/setup cases passed. |
| `npm run check:workflow`, `npm run test:workflow` | Passed after archive; 280 workflow tests. Initial archive inventory: 91 specs, zero active changes and 262 archives; strict spec validation passed. |

The default shell Python lacked `jsonschema`; the supported Python 3.14 environment passed. A sandboxed package attempt could not write npm cache logs; the disposable package check passed with scoped cache access. These setup failures caused no product changes.

The complete production consumer scan found only the migrated core/tracker, producer and dashboard readers. The consumer scan of main `b32fbbec` found no Nanoleaf capture-feature consumer to reinterpret.

The full macOS SDK suite twice passed 397 of 398 tests; the unchanged oversized-request test received `fetch failed` / `EPIPE`. The coordinator's Linux SDK suite passed all 398 on source commit `f41b2c410f906eb52c0d6ce7a8a21c87c8c6e44b`. Its producer suite passed all 32, all 154 runtime scenarios passed, and the full runtime suite passed 1,021 with six environment skips and zero failures. The disposable Linux container was removed. Later changes affect only capture-card CSS, the browser regression and planning/specification artifacts.

## Review and limits

The coordinator performed an independent focused native permission/input safety review of `34d638a0...f41b2c41`, read the UID/permission/output-stream/teardown paths against Apple's installed SDK declarations and ran the substituted adapter suite in a separate frozen copy. It found no blockers. Those reviewed production paths remain unchanged. Full independent Standards/Specification review is still required on the final committed comparison, followed by applicable hosted CI.

These checks do not qualify actual microphone formats or acoustic quality, system permission behavior, signed-helper identity, Bluetooth route effects, protected Music access, installed recovery or physical light timing. Calibration and response tuning are not implemented. The capture path changes no light policy, renderer intake, worker admission or device writer.


## Integration onto merged prerequisites

The reviewed `23cab8ac79ee123a7a152cdf49f61033645f340d` is retained locally as
`codex/gh-721-selected-microphone-reviewed`. Its three microphone commits were
rebased from `34d638a0df86a7e478a59540dc8915b2bc529388` onto merged main
`f2514917bb2614de881565e583b70c29e3bb4f64`. The new base includes the separately
reviewed position helper and prepared timeline, and the merged controls.

The only manual conflicts were in the producer README, native README and
`docs/development.md`. Their resolutions preserve both capture and position-reader
behavior and checks. The two native scripts combined automatically: capture
retains AVFoundation, and the separate position helper retains AppKit and
CoreServices. Range comparison shows only those script contexts and combined
prose; the final microphone specification/layout commit is unchanged.

Direct comparison with the reviewed head confirms that the capture native code,
configuration, supervisor, producer, contracts, runtime server and dashboard
source are unchanged. Direct comparison with the new base confirms that the
position implementation/tests and timeline implementation/tests/specifications
are preserved unchanged. Root manifests and the lockfile are unchanged. No new
calibration behavior was implemented.

Renewed checks all passed on the integrated source:

- Root build, typecheck and JavaScript lint.
- Native build for both helpers; substituted capture, microphone/permission and
  position adapters, including 40 position scenarios; portable signal tests.
- All 43 producer tests, including the selected microphone and position reader.
- All 13 prepared-timeline tests.
- Workflow validation and all 280 workflow tests; strict validation of all 93
  capability specs. Final inventory is 93 specs, zero active changes and 264
  archives.

The incoming controls files and the final microphone UI source are identical to
the reviewed versions. No UI integration change invalidates the preceding full
browser and focused maximum-alias acceptance. The preceding Linux core/SDK and
native-safety evidence covers unchanged microphone behavior. Independent delta
confirmation and applicable hosted CI remain the publication gates. Every renewed
native test uses substituted APIs; no actual audio, permissions, AppleEvents,
installed process or device was exercised.
