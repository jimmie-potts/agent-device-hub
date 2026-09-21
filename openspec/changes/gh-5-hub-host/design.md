## Context

See proposal.md for scope and source links. Hub owns the reducer and its storage interface. Pixoo #31 has delivered `/api/monitor/v1` with an embedded/remote facade; the remote facade requires the same owner ID, monotonically increasing revisions and original command tickets. Nanoleaf owns `nanoleaf.integration/1.0`. Pixoo #33 has not delivered its integration-settings contract.

Design is required by the spec-driven schema because this change crosses services and affects security, durable storage, timing and migration. The user's September 21 Linux/WSL decision supersedes Windows-only wording in the planning context. Native Windows qualification is excluded.

## Goals / Non-Goals

Support a separately started Linux process with one state owner and independent controller clients. Preserve private database ownership, fail-open producers, explicit acknowledgment and uncertain observations. Do not implement another reducer, device writer, dashboard, installer invocation, automatic discovery or cross-OS forwarding.

## Decisions

1. Use Node 24 and the built-in SQLite API for a private durable adapter. A separate SQLite database holds an exclusive lifetime transaction, so process death releases the lease without guessing whether a PID is stale. State commits use atomic revision checks and FULL synchronization. Reject symlinks, non-private directories and mounted `/mnt` storage. This avoids an external database service or shared controller storage.
2. Keep transport compatible with Pixoo's monitor v1 routes. Independently provisioned scoped bearer credentials are checked before reads, commands and replay. Require numeric loopback Host, same-origin when supplied, and the existing native-request marker. Bound bodies, connections, streams, per-device pending work and all remote responses. Do not return native tokens or upstream exception text.
3. Preserve server-issued command identities with bounded canonical replay. Restart changes the command epoch; uncertain prior commands cannot be reissued under an old identity. Controller requests retain their original v1 tickets and revisions. The host never invents a replacement request after transport failure.
4. Quiesce persists a fence before returning an export. Imported owners start fenced and readable. Activation is explicit and must validate consumer routes before accepting ingestion. A failed activation leaves the fence intact. Existing Pixoo quiesce/export and shutdown remain the source-side boundary; operator tooling must verify source release before starting the destination. Local leases cannot alone prove exclusivity between different hosts.
5. Use fixed operator-configured controller endpoints and per-device bounded clients. Validate requests/responses against each released contract. Keep shared-v1 commands separate from Nanoleaf's integration extension. A settings API that is not delivered is unsupported, never an arbitrary proxy.
6. Package only allowlisted application and dependency files. Verify repeated archive bytes and an isolated consumer. Run tests with disposable Linux state, synthetic tokens and ephemeral fake endpoints, without installed services.

## Risks / Trade-offs

- Synchronous SQLite can stall the event loop. Keep lock waits zero, bound state and commits, measure responsiveness against `docs/performance/linux-budgets.json`, and retain failures. Numeric qualification is distinct from correctness tests.
- A valid export alone does not prove the previous owner is stopped. Migration needs verified source release, destination readiness, producer/consumer switching and rollback tests, not an unchecked assertion or automatic fallback.
- Controller settings contracts evolve independently. Pin delivered evidence and reject unsupported versions. Final Pixoo integration stays blocked on #33.
- A loopback credential is still an authority. Scope it by operation/device; rotation must reject old credentials before replay and terminate affected streams.

## Migration Plan

Quiesce and export the selected embedded owner, retain the validated export privately, stop it and verify lease/process release. Import only into an empty destination with matching owner/consumer policies. Start fenced, verify identities/revision/labels/notices, switch the Pixoo facade and other consumer routes, and verify readiness before activating ingestion and switching producers. On failure keep ingestion fenced. Stop/release the destination before restoring the previous route. Rollback after new writes requires a fresh quiesced export into an empty store, not reopening stale state. These are source tooling requirements; this delivery performs no live migration.

## Acceptance mapping and assessment

Complexity high: durable ownership, HTTP and cross-service migration. Impact high: credentials, state and command effects. Uncertainty medium for delivered APIs, high for Pixoo's unpublished settings extension. Ready host work uses executable storage/process, HTTP/privacy, controller-isolation, feed/replay and package tests. Consumer cutover and both settings adapters require owning-service fixtures. Final acceptance also requires guide synchronization, independent Standards/Specification review, all applicable CI and merged-revision verification. Reassess when #33 lands or a migration test disproves the design. No test or fake endpoint establishes installed or physical acceptance.


## Owner-approved service memory revision

On September 21, 2026, the owner explicitly doubled the service RSS constraint
from 128 MiB to 256 MiB and requested budget re-evaluation and memory optimization
as backlog [Hub #123](https://github.com/jimmie-potts/agent-device-hub/issues/123).
That follow-up does not block this change. Preserve the original failed receipts
and use the revised budget for new checks. Other limits and migration/controller
acceptance are unchanged. A passing API memory probe is not full integrated
qualification under #30.
