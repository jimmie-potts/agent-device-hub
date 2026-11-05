## 1. Bounded source behavior

- [x] 1.1 Add immutable timeline preparation and prove invalid/bounded/round-trip behavior with a failing-before test and passing focused tests.
- [x] 1.2 Add explicit-clock cursor controls and prove exact boundaries, missed cues, pause, seek, generation and terminal fencing in deterministic tests.
- [x] 1.3 Reuse the existing renderer and validate both synthetic layouts with no device or timer dependency.

## 2. Source verification

- [x] 2.1 Document the internal interface and remaining integration boundaries, and verify instructions by readback.
- [x] 2.2 Run build, typecheck, lint, Nanoleaf and workflow checks, and a disposable synthetic exercise; report actual results separately from physical acceptance.
- [x] 2.3 Confirm current OpenSpec lookups, capability validation and completed implementation tasks before synchronizing and archiving this bounded source change. Independent review applies to the resulting committed comparison.
