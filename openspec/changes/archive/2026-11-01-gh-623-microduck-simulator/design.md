## Context

See proposal.md and [#620](https://github.com/jimmie-potts/agent-device-hub/issues/620). Reachy supplies registration, SDK/core dispatch, frontend commands and private responsibility/outbox patterns. MicroDuck head inputs persist independently of client lifetime; RPC IDs are not motion tasks. Design is required for the external protocol, writer admission, process supervision and durable effect uncertainty.

## Goals / Non-Goals

Provide the accepted simulator-only head increment without a generic vendor command path. The module owns device facts, writer and outcomes; core owns sessions, mode and live opportunities. Companions retains personas, memory and speech. Physical admission, installation, beak, audio and walking remain separate.

## Decisions

- Configuration admits a neutral target/revision and a private fixture root, never an arbitrary endpoint. A TypeScript development fixture starts the pinned vendor pair, verifies hashes/arguments/Linux process identity/shared time namespace, writes a restrictive witness and supervises both loss directions. Adapter admission checks this live witness before connection and every write. The final synchronous witness/guard check and socket send have no await gap. A Boolean or hello cannot prove backend identity.
- One bounded Unix JSON-RPC connection owns reply correlation, 10 Hz observation, 500 ms calls, two-second connection attempts and 256 KiB framing. Parse t_ns from its original numeric token without Number rounding. Compare with process.hrtime.bigint in the same Linux time namespace; refuse inconsistent clocks. Forward no B.U.N.N.Y. metadata to vendors.
- One transaction queue owns state; a control epoch fences presend work. Persist responsibility before accepted and each possible write. Stop/takeover abort without vendor waiting. Phase clocks start at actual send and retain the absolute SDK deadline. Recovery uses a new request and two advancing zero-input samples; restart reconstructs outcomes only.
- Use module-owned closed schemas and one internal microduck-dispatch core family. Reuse core's existing live opportunity without another reducer. Consume origins before policy gates, count eligible sessions, retain one active/one latest pending candidate and rate limits.
- The frontend uses the shell participant and independent command attempt keys. Stop needs authenticated target identity but no stale device guards. Neutral recovery binds exact hold/configuration/generation. MCP is cached status only; public/internal motion and inbox resend remain refused.

## Risks / Trade-offs

- Persistent last input after cancellation/lost reply requires a hold and new guarded neutral, not a claimed vendor TTL or physical rest.
- The model omits mouth and synthesizes health. Label head inputs, policy targets and simulated joints separately and withhold physical health claims.
- Witnesses prevent accidental targets/writers, not a malicious same-user actor. Bind PIDs with start identity and namespace, pin hashes and refuse missing evidence.
- Process termination belongs only to disposable fixtures; no hardware stop method follows from it.
- Event-loop delay may miss a phase window. Preserve uncertainty instead of sending late cleanup.

## Migration plan

Add a new private module store and static registration. Missing configuration refuses only this module. No existing storage format or installation changes. Source acceptance uses synthetic fakes and a pinned actual vendor container; physical adoption retains its own reviewed gate.
