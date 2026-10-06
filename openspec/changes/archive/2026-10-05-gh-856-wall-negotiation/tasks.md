## 1. Negotiation

- [x] 1.1 Add a fake-controller mode that refuses the versioned read with 404 `invalid-request`, and failing tests for the client and the snapshot route.
- [x] 1.2 Accept the 404 refusal as a 1.0-only verdict in `negotiatedRead` without marking the controller unavailable. Keep `unknown-device` failing.

## 2. Composition

- [x] 2.1 Read consumers through the dashboard's versioned path in readiness and `doctor`, with a stand-in fault and a test that readiness fails.
- [x] 2.2 Pass the Hub's proof root to every adapter unless `APP_VERIFY_PROOF_ROOT` is set.

## 3. Docs and delivery

- [x] 3.1 Update the Hub README, the app verification doc and the controller contract note.
- [x] 3.2 Run the build, typecheck, hub, controller, MCP, workflow and verify suites, then sync and archive this change.
