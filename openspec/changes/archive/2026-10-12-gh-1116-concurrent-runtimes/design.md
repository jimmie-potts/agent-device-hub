## Context

See proposal.md for the owner decision. The core already supports concurrent
runs; only normal entrypoints opt into a host-wide guard. Design is included
because this changes concurrency across npm, the host dispatcher and adapters.

## Goals / Non-Goals

Preserve one owner per disposable run and independent build outputs. Household
installation stays serialized; physical devices retain their designated writer
and explicit authorization. No lifecycle, error, diagnostic or trace redesign.

## Decisions

Remove the four npm environment assignments and the host environment field.
Keep the core and composition guard code unchanged for explicit npm opt-in.
The host route continues to clear inherited environment, including caller guard
settings. Replacing the guard with a scheduler or capacity check would contradict
#1116 and is unnecessary for the existing isolated lifecycle.

The boundary remains npm/host launcher to adapter/app-verify. Success,
prerequisite failure, uncertain start, expiry and partial cleanup keep their
existing operation-contract effects and codes under ADR 0012. An uncertain start
is reconciled through its exact receipt and doctor; it is never retried blindly.
The diagnostic contract, minimal environment and loopback/auth checks are unchanged.

## Risks / Trade-offs

- Concurrent runs consume host resources. Stop unneeded owned runs if constrained;
  recurring contention can justify a focused follow-up, without a new admission gate.
- A shared worktree could mix build identities. Use a separate candidate worktree
  and build per run; record identities, ports and private credential/state isolation.
- Cleanup could disturb a sibling if ownership is guessed. Exercise reset and
  stop by exact owned run ID and verify the sibling's health and state afterward.

## Migration Plan

This is source-only development tooling: no service installation or personal
configuration change. Existing runs keep their leases. Reverting the entrypoint
change restores the previous defaults without changing stored state. Retain
private proof, stop only demonstration-owned runs, and verify cleanup.
