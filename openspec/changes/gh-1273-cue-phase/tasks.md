## 1. Validation setup

- [x] 1.1 Document focused phase and byte-parity checks and verify existing Core modules CI discovers their test files before implementation.
- [x] 1.2 Add focused phase tests and demonstrate the intended missing-helper failure before production changes.

## 2. Canonical frame preparation and location

- [x] 2.1 Extract canonical frame preparation and add immutable cue preparation; verify ordinary payload byte digests, Lines/NL22 addressing, intensity, input isolation and existing refusals.
- [x] 2.2 Add stateless transition location; verify exact and unequal-duration boundaries, unknown initial origins, loop/one-shot completion, invalid input and current pause/seek elapsed positions.

## 3. Integration evidence

- [x] 3.1 Update the module guide and verify instruction/API readback without a runtime restart or device operation.
- [ ] 3.2 Pass build, typecheck, lint, controller contracts, workflow, full Nanoleaf and direct consumer checks; validate, synchronize and archive the completed OpenSpec change before the frozen review candidate.
