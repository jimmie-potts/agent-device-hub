## Context
The owner accepted #619's reviewed definition and actual headless MuJoCo evidence. See proposal.md for scope and the linked issue for evidence. This design is required because commands, storage, ownership and browser boundaries change.

## Goals / Non-Goals
Preserve the existing core, SDK, diagnostic and companion owners. This source increment admits only explicit simulated targets. Production USB routing and physical acceptance remain separate.

## Decisions
- A new module owns its private SQLite state, request fences, device facts and outbox. SDK sync copies core mode/sessions; copies are not persisted. Initial state is unavailable until both vendor streams and matched daemon status are fresh.
- Local HTTP sends finite vendor tasks; two bounded WebSockets receive state and UUID task events. Endpoint redirects, non-loopback targets and non-simulated backend identity are refused. Tests inject a deterministic transport instead of altering vendor control logic.
- Manual controls use the existing core dispatcher. A shared closed reachy-dispatch contract admits only the Reachy module to forward automatic gestures through that same tracker, using a private reachy-auto command family. The browser and MCP refuse internal families; MCP exposes cached status but no robot motion.
- Every stage has a persisted started fence and a final live expiry/mode/source/ownership/generation/freshness check immediately before POST. Stop has its own responder, invalidates active work and cancels only the known UUID. No implicit return move occurs after interruption.
- Successful vendor task return alone is insufficient. Require matching task completion and fresh simulated pose consistent with the requested target. Outcomes remain uncertain when evidence is missing or conflicts. Cancellation reports task cancellation, never physical rest.
- Unknown UUIDs after an ambiguous send create a persistent hold. A guarded new person-command after explicit recovery follows device/2.1 semantics; refusal preserves the prior hold and uncertain recovery replaces it.
- Persist automatic enablement but require explicit restoration after restart. Pending candidates and core copies are transient. Deduplicate source opportunity identity durably before dispatch; never replay missed reactions. A bare turn end is suppressed; a coding notice requires a matching current unacknowledged notice.
- Registered static diagnostic records and existing tracing retain command context; no vendor headers carry trace context. Vendor errors are normalized once and never exported verbatim.
- The React contribution uses the shell participant and Command UI. The shell Command contribution adds an optional module-qualified attemptKey; Stop uses it so a pending or unanswered gesture cannot disable task cancellation. The default target lock remains shared for ordinary controls.

## Risks / Trade-offs
- Upstream app locks do not fence direct clients. Require explicit ownership of the disposable simulator; withhold physical targets pending the installed gate.
- Task cancellation leaves targets active. State and copy distinguish cancellation from settling; physical stopping is unqualified.
- Source meshes require Git LFS hydration. The actual-vendor exercise uses immutable verified assets in private scratch, with media and telemetry disabled.
- Private durable state cannot authorize motion on startup. Pending responsibility is classified without any resend.

## Migration Plan
Additive new module and shared family only; no existing stores change. Source validation uses synthetic private stores and isolated loopback vendor simulation. Installation requires the owning current-runtime procedure and separately qualified target; no automatic deployment or rollback is introduced.

