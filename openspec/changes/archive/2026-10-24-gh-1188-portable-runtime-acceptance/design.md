## Context

See proposal.md and #1188. The shared package already exposes `runCaptureStep`, including asserted screenshots/video and artifact rechecks, independently of its systemd lifecycle. The runtime already supplies synthetic seeds, a guarded supervisor and app-specific capture steps. Those unmanaged test primitives alone have no owned run receipt or independent deadline.

## Goals / Non-Goals

**Goals:** one finite opt-in review operation on the existing Docker Linux engine, honest portable evidence, no effect on installed services, and compatibility with the existing managed route.

**Non-Goals:** detached previews, extend/reset/handoff, new host infrastructure, a native Mac runtime, migrating legacy adapters, or an installed-client test substitute.

## Decisions

1. Keep the old lifecycle unchanged. Add bounded Docker orchestration to the shared package and one runtime-specific in-container driver; reuse existing capture and synthetic supervisor rather than create another browser/assertion framework. The host selects a known step and immutable image, never an arbitrary shell command.
2. Use a test-only derivative of an exact committed-source runtime image, with pinned project Chromium/video tooling. Candidate files are root-owned/nonwritable to UID1000. Run with network none, no ports/mounts/devices/socket/privilege/host namespaces and no automatic restart. Data/HOME/proof live in an owner-only disk-backed directory outside the candidate checkout. The production image gains no browser dependency.
3. Arm GNU timeout before invoking Node, under Docker init. A process outside the candidate/browser event loops enforces a nonrenewable deadline; container exit terminates namespace descendants. Eligibility requires measured normal exit, stalled-loop/detached-child expiry and caller-loss controls on the selected engine. A failed control blocks use. Host sleep or inaccessible Docker is not verified realtime expiry.
4. Use an explicit versioned portable receipt, not fake unit/timer fields in `app-verification/1`. Keep old validators and consumers unchanged. Record clean source/artifact/image/container/run identity, deadline, observation outcome, retained proof hashes and separate stopped/removal evidence. A passed capture is evidence, not an independent reviewer verdict.
5. Persist a pending receipt before external effects. All later actions use exact container/run/image identity and inspect effective isolation. Stop and verify PID0/not-running before proof export or deletion. Retain the stopped container on unknown cleanup or proof failure; caller-loss recovery uses the same receipt/ownership path, never broad prune or name-based deletion.
6. Export only a bounded allowlist of regular finalized capture artifacts and manifest from the stopped container, validating names, sizes, hashes, candidate and observation identity. Never copy runtime/config/HOME/logs wholesale or follow symlinks. Preserve failed/partial evidence privately without labelling it complete. Delete only the verified owned container after proof survives in the canonical ignored proof root, then verify absence.
7. Add a focused synthetic Mac Codex capture to the runtime adapter: real wrapper, metadata-only source-bound ingestion, actual dashboard activity/finished state, browser recovery, admission refusals and fail-open checks. Keep personal Desktop/CLI observations separate. The independent reviewer still selects and executes appropriate steps and judges requirements.

## Risks / Trade-offs

- Docker read/stop uncertainty → unsuccessful result, retained private resources, exact-identity recovery.
- Interrupted export → keep stopped container and pending/failed receipt; no automatic removal or false success.
- Candidate drift or untrusted proof paths → refuse on revision/artifact/name/hash/type mismatch.
- Suspended VM/daemon → no realtime-expiry claim; reconcile on return before cleanup success.
- Procedure approves its own shortcut → explicit owner-authorized ADR/SDLC amendment, unchanged independent axes/CI/merge gates, real independent portable qualification before the consumer gate resolves; prior unsupported reports stay incomplete.

## Migration Plan

Add the opt-in command and portable receipt without modifying old managed operations. Qualify the finite boundary and affected negative controls, renew independent source/Acceptance reviews and hosted checks, then use the documented alternative for #1183 on the current exact candidate. No household update or data rollback is part of this change.
