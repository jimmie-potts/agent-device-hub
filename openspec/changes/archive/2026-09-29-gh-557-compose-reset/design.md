## Context

See proposal.md for the outcome and owning issues. The composition already starts, diagnoses, captures, hands off, extends and stops three independent app-verify runs. Its record lock protects individual writes, but it does not exclude competing operations. The consumer pause/release protocol is owned by the separately delivered adapters. Their runtime-root controls survive the core's data reseed; the old process stops before the seed callback consumes a matching release.

A design is required by the schema because this change coordinates multiple services, process identity, timing and failure recovery.

## Goals / Non-Goals

**Goals:** Keep orchestration in the existing compose command; use the existing adapter and user-unit lifecycle; make the reset order, current phase and recovery observable.

**Non-Goals:** No installed-service migration, device access, generic distributed protocol, new daemon, reusable core version or guarantee against a hostile process owned by the same user. No automatic rollback or command retry after an uncertain failure.

## Decisions

1. Provide a separate `reset <id>` command. The issue permits this interface and it avoids coupling a new reset to proof freezing. Existing handoff stays unchanged.
2. Reuse `DirectoryLock` with a separate operation-lock name around public aggregate operations. The short record lock remains responsible for record writes. Include doctor because its direct Hub probes are outside the consumers' serving-process drain. New starts hold their operation lock once their record exists; replacement starts require verified prior cleanup. Live operations wait at most the existing lock budget, and dead-holder recovery preserves cleanup after interrupted injection/reset. Every adapter wrapper runs behind a child-held barrier for its recorded service; sibling services within one aggregate operation can run concurrently so a waiting Hub capture does not block its consumer injection: its runner verifies the parent PID/start inside the barrier before spawning, watches parent death, terminates the wrapper process group on interruption or timeout, and releases only after that group stops. A new aggregate operation drains every recorded service barrier before effects, plus the legacy shared barrier for any runner from the earlier candidate. This closes the observed orphan-wrapper race without changing core lifecycle ownership.
3. Put pause file and live-identity validation in a small verification helper. Use real private files, fresh per-consumer nonces and a bounded wait. Refuse pre-existing controls, unsafe directories/files and acknowledgments whose run, nonce or PID differ. Validate receipt runtime/unit ownership, PID and process start against the live unit and its current lease. Recheck both consumers immediately before owner reseed. A timestamp alone does not tie an acknowledgment to its process. Polling through HTTP instead would itself create the traffic being drained.
4. Persist `resetting`, cleared readiness, attempt, phase and affected service before effects. Pause consumers together, reseed the owner with recorded integrated inputs, then release and reseed each paired consumer in turn. The helper leaves requests in place on both success and failure; only the successful authorized consumer seed consumes them. Keep port/address invariants explicit in adapter results and finish through existing composition readiness.
5. Keep partial failures visible and stoppable. Record `reset-failed` with the failure phase, service and known results; retain pauses on consumers not yet reseeded. Do not infer that a wrapper timeout means its unit stopped. Later stop attempts every recorded run owner-first using the existing thaw/lease and exact-unit fallback. Restart requires cleanup first, so a failed reset cannot leave old owners alongside a replacement.
6. Test the filesystem/identity protocol portably with a narrow injected systemd query, then test aggregate ordering and failure recovery through the existing real-unit fixture and real accepted consumers. Assertions cover observable calls and retained artifacts; a negative control must demonstrate that missing/stale drain evidence cannot authorize owner mutation.

## Risks / Trade-offs

- A lease can expire during a phase → validate current ownership before effects; later readiness or adapter failure records the actual result, and stop remains available. Never extend a lease implicitly.
- A process or control can change after its final read → serialize ordinary aggregate operations and reject any observed mismatch. Out-of-band same-user mutations are outside the atomicity guarantee.
- A reset process can die midway → write the phase first, retain controls, recover the dead operation lock and use stop rather than guessing progress or replaying commands.
- Consumer reseed fails after the core stopped it → report its stopped/failed result and cleanup; do not erase preserved frozen proof or release another consumer early.
- Hosted CI lacks a usable user manager → keep portable checks distinct and qualify a pinned candidate in the owner's WSL terminal with disposable roots and retained logs.

## Migration Plan

Adopt the accepted consumer squash revisions in compose.json, preserving their core version. Existing compositions retain their recorded candidates; reset verifies current source/receipt identity and refuses incompatible or changed runs. No running installation is migrated. Source rollback uses a normal reviewed revert; an incomplete disposable composition is stopped before creating another.
