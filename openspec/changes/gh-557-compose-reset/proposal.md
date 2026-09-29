## Why

A composed preview cannot return to its paired starting state without replacing the whole composition. Reseeding the Hub alone restarts its revision sequence beneath live consumers. [Hub #557](https://github.com/jimmie-potts/agent-device-hub/issues/557) requires an aggregate reset that preserves ownership, ports, pairing and retained proof.

## What Changes

- Add `verify:compose -- reset <composition-id>` using the existing adapter scenario operations.
- Pause and drain both live consumer feeds before reseeding the Hub; keep consumer pages and local controllers available during that owner step.
- Authorize each consumer's fresh paired seed only after the Hub resets, then require all composition readiness checks to pass.
- Serialize aggregate operations, including diagnostic probes, and record the current reset phase and service before each effect. Partial or interrupted resets remain cleanable through `stop`.
- Preserve run identities, recorded ports, pairing tokens, frozen proof and the existing lease-safe thaw behavior.

## Capabilities

### New Capabilities

- `composed-preview-reset`: ordered reset of a disposable composed preview, operation exclusion, failure reporting and retained evidence.

### Modified Capabilities

None. Existing composition behavior remains documented in `docs/app-verification.md`; the new specification owns only the reset and its operation-exclusion boundary.

## Impact

Changes are limited to `apps/hub/verify`, its tests, consumer source pins and the owning verification guides. The accepted cross-repository pause/release contracts belong to [Nanoleaf #201](https://github.com/jimmie-potts/codex-nanoleaf/issues/201) and [Pixoo #127](https://github.com/jimmie-potts/divoom-app-upgrade/issues/127). Hub consumes their merged revisions after required acceptance and does not import their internals or write consumer data directly.

No installed runtime, physical device, shared controller API, reusable core version or visible UI changes. The separate `reset` command is sufficient for this issue; `handoff` continues to freeze proof and print the existing card.
