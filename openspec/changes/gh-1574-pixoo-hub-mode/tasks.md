## 1. Contracts

- [ ] 1.1 Make `HUB_MODE_TABLE.pixoo` the identity, update the README table, the `nativeMode` schema text and fixtures; failing then passing `packages/event-contracts/tests/devices.test.mjs` and `mapping.test.mjs`.
- [ ] 1.2 Drop `requireMode` from `pixoo-media-show/2.0` and add `pixoo-display/2.1` in the module's schemas; failing then passing `modules/pixoo/tests/module/conformance.test.ts`.

## 2. Pixoo module

- [ ] 2.1 Accept `quietBrightness` and an ignored presentation `mode` in configuration and store; failing then passing `configuration.test.ts` and `store.test.ts`.
- [ ] 2.2 Persist the last Hub mode and remembered brightness; `device-mode-set` saves, publishes, then applies the Work stop or the Quiet/remembered brightness, writing nothing at startup; failing then passing `module.test.ts` with the manual clock.
- [ ] 2.3 Replace the Monitor/Media presentation with the status and playback bases, Now Playing pop-up in every mode and whole takeover in Free and Quiet only; failing then passing `monitor-presentation.test.ts`, `now-playing-presentation.test.ts` and `monitor-content.test.ts`.
- [ ] 2.4 Refuse playback starts in Work and any `requireMode` at admission, cancel a capturing start when Work arrives; failing then passing `module.test.ts` and `control.test.ts`.
- [ ] 2.5 Admit moments and exact art per base with cover-status required in Work only, remove the empty-pause branches; failing then passing `moment-presentation.test.ts`, `art.test.ts` and `artwork-admission.test.ts`.
- [ ] 2.6 Publish `pixoo-display/2.1` and `moments.overStatus`, rename the switch and update the module README; failing then passing `conformance.test.ts` and `module.test.ts` on the record shape, and a README readback by the reviewer.
- [ ] 2.7 Adapt the runtime dashboard reader to `pixoo-display/2.1` and the advertised Hub mode (`devices.ts` `contentBlocked`, the `mode-exceptions.ts` reverse map, the Pixoo frontend pages' record reads) without the visible redesign, which is #1575; failing then passing `apps/runtime/dashboard/tests/devices.test.ts`, `mode-exceptions.test.ts` and the Pixoo browser tests on the fixture runtime.

## 3. Core

- [ ] 3.1 Replace the routine content-mode precondition with the optional Hub-mode precondition checked before the send and stop sending `requireMode`; failing then passing `power-schedules.test.ts` and `scenarios/power-schedules.ts`.
- [ ] 3.2 Confirm the Hub-mode fan-out and the automation target mapping with a Pixoo advertising Hub modes; passing `mode*.test.ts`, `scenarios/hub-mode.ts`, `scenarios/modules/pixoo.ts` and the art scenarios.

## 4. Records and validation

- [ ] 4.1 ADR 0014 with the ADR 0005 and 0013 amendments and the architecture sentence; readback by the independent reviewer.
- [ ] 4.2 Run build, typecheck, lint:js, test:pixoo, test:pixoo:python, the contract, runtime, workflow and dashboard checks; all exit zero, reported with the specification inventory.
- [ ] 4.3 Independent Standards and Specification review with a disposable acceptance exercise on the simulated Pixoo, then synchronize the deltas and archive the change on the delivery branch.
