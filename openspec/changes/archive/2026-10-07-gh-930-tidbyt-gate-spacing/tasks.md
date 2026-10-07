## 1. The gate from the end of the call

- [x] 1.1 Let the module tests delay a push on its way to the simulated cloud on the manual clock (`pushTransitMs`).
- [x] 1.2 Assert, red before the change, that when the first push takes 300 ms to reach the cloud the next one reaches it at least 15 s after the first arrived: `modules/tidbyt/tests/module.test.ts`, "the gate runs from the push's answer…" (main saw 14,700 ms).
- [x] 1.3 Assert that a push that takes 9 s to arrive and never answers holds the gate from its 10-second deadline: "a push that never answers holds the gate from its deadline…".
- [x] 1.4 Time `TileWriter`'s gate and refresh from the end of each call that went out, and show that a writer timing from the send and one timing from the answer only when the push was sent each fail the named tests.

## 2. Documentation and qualification

- [x] 2.1 Update the module README's gate, restart and test descriptions and the `runtime-tidbyt` requirement.
- [x] 2.2 Run build, typecheck, lint, the Tidbyt module, runtime, scenario and verify suites, and the workflow and OpenSpec checks.
