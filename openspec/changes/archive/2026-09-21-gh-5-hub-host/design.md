## Context

See proposal.md for scope and source links. Hub owns the reducer and its storage interface. Pixoo #31 has delivered `/api/monitor/v1` with an embedded/remote facade; the remote facade requires the same owner ID, monotonically increasing revisions and original command tickets. Nanoleaf owns `nanoleaf.integration/1.0`. Pixoo #33 has delivered its integration-settings contract through PR #64; the hub adapter validates that finite extension and routes it through the existing owner.

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
- Controller settings contracts evolve independently. Pin delivered evidence and reject unsupported versions. The adapter and owning-service tests pin the delivered #33 API.
- A loopback credential is still an authority. Scope it by operation/device; rotation must reject old credentials before replay and terminate affected streams.

## Migration Plan

Quiesce and export the selected embedded owner, retain the validated export privately, stop it and verify lease/process release. Import only into an empty destination with matching owner/consumer policies. Start fenced, verify identities/revision/labels/notices, switch the Pixoo facade and other consumer routes, and verify readiness before activating ingestion and switching producers. On failure keep ingestion fenced. Stop/release the destination before restoring the previous route. Rollback after new writes requires a fresh quiesced export into an empty store, not reopening stale state. These are source tooling requirements; this delivery performs no live migration.

## Acceptance mapping and assessment

Complexity high: durable ownership, HTTP and cross-service migration. Impact high: credentials, state and command effects. Uncertainty is medium for the delivered APIs and reduced by disposable owning-service migration checks. Ready host work uses executable storage/process, HTTP/privacy, controller-isolation, feed/replay and package tests. Consumer cutover and both settings adapters require owning-service fixtures. Final acceptance also requires guide synchronization, independent Standards/Specification review, all applicable CI and merged-revision verification. Reassess against the delivered #33 contract and when migration tests challenge the design. No test or fake endpoint establishes installed or physical acceptance.


## Owner-approved service memory revision

On September 21, 2026, the owner explicitly doubled the service RSS constraint
from 128 MiB to 256 MiB and requested budget re-evaluation and memory optimization
as backlog [Hub #123](https://github.com/jimmie-potts/agent-device-hub/issues/123).
That follow-up does not block this change. Preserve the original failed receipts
and use the revised budget for new checks. Other limits and migration/controller
acceptance are unchanged. A passing API memory probe is not full integrated
qualification under #30.


## Implemented handoff and recovery

The migration API directly supervises Node child owners and binds startup endpoints to those processes. It validates and synchronizes a private export, verifies graceful process exit, then issues one opaque, single-use import capability. Runtime validation requires staged import even for JavaScript callers. Failed startup terminates its own child. Independently managed services need an explicit owner-led transition into this supervision.

A host admission gate leaves the core readable while fencing ingest, label and acknowledgment writes. Export remains available for recovery. Activation verifies every configured consumer through the actual authenticated Pixoo facade and checks ingest/control authority. Producer files are enabled while admission remains closed. The durable fence clears synchronously with opening admission, after all readiness work. Any failed attempt stays fenced and cannot activate again.

Private route files use an OS-released exclusive lease, compare-and-swap preimages and a durable intent containing original producer enablement. Initial intent is atomically published before route mutation. Ambiguous sync failures and coordinator death retain recovery evidence; another live coordinator or unknown edits reject. Recovery preserves source identity and qualification. Releasing an unfinished attempt does not discard its original enablement.

Rollback exports the latest accepted writes and imports them into a fresh host store. The original Pixoo app remains a remote facade with its media and presentation preferences. Reopening its occupied embedded store would resume stale state and is unsupported. Installed Nanoleaf consumer switching remains with #8; this delivery verifies its Linux controller/settings API through the owning service's deterministic fixture.

Consumer activation accepts the supervised Pixoo handle, not a free-form monitor URL. The launcher binds the handle to the startup endpoint, private credential and exact agent-monitor configuration bytes. Readiness checks that proof and the actual facade snapshot, then rechecks files and process liveness before opening admission. Only the supported `pixoo` consumer identity is accepted.
