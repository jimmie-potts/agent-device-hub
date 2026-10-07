## 1. Tests first

- [ ] 1.1 Add the `device/2.1` fixtures and invalid cases to `fixtures/v2/devices.json`, and to `tests/devices.test.mjs` the version, registration and schema-equality checks. Evidence: red at the tests-first commit, where the held fixtures fail with `unsupported-version`.
- [ ] 1.2 Assert in `journal.test.ts` that a hold records its operation, keeps its first one, and clears with a release or a new mode revision. Evidence: red at the tests-first commit.
- [ ] 1.3 Assert in `module-faults.test.ts` that the device record's `held` names the held write and its start while the hold lasts, after a restart too, and is gone after a mode command or a fresh control releases it. Evidence: red at the tests-first commit.
- [ ] 1.4 Assert in the `nanoleaf-wall` catalog scenario that the reader's device record names `req-lost` while the wall is held and has no `held` after the release. Evidence: red at the tests-first commit.

## 2. Contracts

- [ ] 2.1 Add `device.2.1.schema.json`, register it beside 2.0 with the hold checks, and type `held` in `DeviceRecord`. Evidence: `tests/devices.test.mjs` passes.

## 3. Nanoleaf

- [ ] 3.1 Record the held operation in `control_holds` with the hold, pass the runtime's clock to `hold`, and read it through `holdOf`. Evidence: `journal.test.ts` passes.
- [ ] 3.2 Publish `device/2.1` with `held` from the same presence as availability, the wall view and the hold's log records. Evidence: the module tests and the catalog scenario pass.

## 4. Docs and checks

- [ ] 4.1 Document `held` and `device/2.1` in the package README and MAPPING.md's `device` rows, and the record's `held` in the Nanoleaf README and PORTING.md.
- [ ] 4.2 Run the gate and the negative controls; sync and archive this change.
