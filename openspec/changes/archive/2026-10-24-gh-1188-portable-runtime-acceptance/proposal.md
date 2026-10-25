## Why

[#1188](https://github.com/jimmie-potts/agent-device-hub/issues/1188) removes an environment blocker for independent Acceptance of [#1183](https://github.com/jimmie-potts/agent-device-hub/issues/1183). The existing Mac has Docker but cannot supply the Linux user manager required by the managed preview route; a finite isolated review does not need a long-lived preview.

## What Changes

- Add one explicit portable foreground runtime review operation using an exact-candidate test image, synthetic state and an in-container browser with no external network or published ports.
- Reuse shared capture, assertions and artifact checks; add honest portable run identity, bounded ownership and verified cleanup without fabricating systemd resources.
- Retain stopped resources until validated proof is copied to the canonical ignored proof root. Unknown stop or cleanup never passes.
- Document the owner-authorized alternative explicitly in the SDLC and ADR 0009, retaining the systemd preview route and independent reviewer/CI/merge gates.

## Capabilities

### New Capabilities

- `portable-runtime-acceptance`: finite Docker-isolated runtime review with independent observation, private fixtures, exact identity, expiry and owned cleanup.

### Modified Capabilities

None. Existing managed previews retain their contracts.

## Impact

Shared development tooling in `packages/app-verify`, the runtime verification adapter, a test-only image and focused verification/command routing. No application message format, installed state, real credential, device writer, host service or security setting changes. Source preparation and disposable qualification remain separate from the already verified installed Desktop/CLI evidence.
