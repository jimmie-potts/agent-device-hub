## 1. Music position

- [x] 1.1 Consume the playback owner's position stream. Use synthetic observations to verify stale, unsupported, ambiguous, and reordered evidence handling.
- [x] 1.2 Match a scoped Music library item and project its position within the accepted bounds. Verify pause, seek, and change cases with a fake clock.

## 2. Measured show authoring

- [x] 2.1 Prepare bounded cues from existing Music measurements. Verify that preparation never requests capture or device work and rejects mixed source or item generations.
- [x] 2.2 Save and read measured versions with scoped item identity and analysis provenance. Verify immutable reads, invalid data refusal, recovery, and old decorative records.
- [x] 2.3 Expose preparation and editing through the existing show editor. Verify that preview and editing send no lighting commands.

## 3. Measured show playback

- [x] 3.1 Start an explicitly selected measured version at the current matched Music position. Verify wrong and stale items never take device control.
- [x] 3.2 Handle pause, seek, item and output change, and source loss in the existing worker. Verify obsolete work is fenced and the device restoration rules apply.
- [x] 3.3 In a disposable runtime, prepare, edit, save, preview, replay, and stop a synthetic measured show. Exercise both simulated device families and preserve decorative starts.
- [x] 3.4 Run the affected build, lint, contract, workflow, module, and runtime checks. Verify synchronized specs and archive the completed change.
