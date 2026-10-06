## Why

[Hub #856](https://github.com/jimmie-potts/agent-device-hub/issues/856): the installed B.U.N.N.Y. dashboard shows the Nanoleaf wall card as stale or unknown. The first tier-2 Acceptance review found the cause while running a composed preview for #665.
- The dashboard reads controllers with `apiVersion=1.1`.
- The Nanoleaf controller refuses that unknown read parameter with 404 `invalid-request`.
- The Hub falls back to 1.0 only on a 400, so it reports the wall unavailable.

The composed preview's readiness passed anyway, because it read the unversioned snapshot. Consumer proof was also kept inside disposable consumer checkouts.

## What Changes

- **Negotiation.** The controller client treats a 404 `invalid-request` refusal of the versioned read as a 1.0-only verdict, like a 400, without marking the controller unavailable. Every other 404 still fails.
- **Readiness.** Composition readiness and `doctor` read consumers through the dashboard's versioned path.
- **Proof root.** The composition orchestrator gives every adapter the Hub's proof root unless one is already set.
- **Tests.** The shared fake controller gains a `1.0-unknown-route` mode, and the stand-in consumer gains a `versioned-read-fails` fault.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `standalone-hub-host`: controller snapshot version negotiation accepts the 404 refusal.
- `composed-preview-reset`: adds composition readiness through the dashboard's read, and the shared proof root.

## Impact

- **Source:** `apps/hub/src/controllers.ts`, `apps/hub/verify/compose.mjs`, hub and verify tests and fixtures.
- **Docs:** `apps/hub/README.md`, `docs/app-verification.md` and `docs/controller-contract.md`.
- **Nothing else:** no contract package, Nanoleaf or Pixoo source changes. The fix is installed on the owner's Hub.

**No design.md.** The change narrows one error mapping, switches one read path and passes one existing environment override. It has no new concurrency, migration or timing behavior.
