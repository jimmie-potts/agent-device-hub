# Agent lifecycle contract 1.0

[Hub #2](https://github.com/jimmie-potts/agent-device-hub/issues/2) owns this source contract. [Provider qualification](provider-qualification.md) owns the version/evidence matrix and required-client stops. The `agent-lifecycle-contract` OpenSpec capability defines the observable requirements. This package validates metadata; it implements no reducer, emitter, listener, storage or installation.

## Artifact and validation

`@jimmie-potts/agent-lifecycle-contracts` 1.0.0 contains the Draft 2020-12 schema at `schemas/lifecycle-v1.schema.json`, the common corpus at `fixtures/lifecycle-v1.json`, TypeScript exports and Python `agent_lifecycle_contracts`. `validateEvent` / `validate_event` return a detached `{ok:true,value}` or exactly `{ok:false,code:"invalid-event"}`. Errors expose no input, field names or provider exceptions. `deduplicationKey` / `deduplication_key` return `{kind,key}` or null for invalid input.

All objects are closed. API version is exactly `1.0`. Identifiers use 1-128 ASCII letters, digits, underscores, dots or hyphens and must originate as neutral identifiers, never encoded private content. Labels are optional explicit user input, 1-80 Unicode scalar values without control characters; `origin:"user"` records the adapter's provenance claim. Project IDs are also explicitly assigned, never derived from a path or title. Validation cannot prove how a string originated: the provider adapter must construct an allowlist before this boundary and must never spread the provider payload into the envelope.

Each envelope is at most 8192 UTF-8 JSON bytes, depth 8 and 256 visited values including object keys. Arrays, accessors, non-JSON objects, non-finite/unsafe/fractional numbers and malformed Unicode are rejected. These are finite contract admission bounds, not measured performance budgets. Downstream HTTP parsers must bound raw bytes before parsing; source adapters must discard excluded fields before transmission. Rejection does not log or persist the input.

## Identity and clocks

The selector is `{provider,client,hostId,sourceId,sessionId}`. Codex uses client `cli` or `desktop`; Claude uses `code`. `sourceId` identifies one configured producer installation and survives ordinary runtime restart. Operators choose its stable neutral namespace. A route handoff preserves identity only through the explicit future owner migration. Concurrent sessions in one project never combine.

`turn` is `{status:"known",id}` or `{status:"unknown"}`. `parent` is unknown, explicitly evidenced top-level, or a known parent selector. A child event uses the child's session ID and the actual parent's selector. V1 accepts an evidenced parent only in the same provider/client/host/source namespace with a different session ID. Unknown parentage never increments a guessed child count. A provider that cannot distinguish root and child namespaces must not claim qualified child aggregation.

`observedAtMs` is the producer's wall-clock Unix millisecond observation, generated once for an observation and retained on retry. Optional `occurredAtMs` is evidenced provider occurrence time in the same declared convention. These integers are display/evidence timestamps, not cross-process latency measurements. `ordering` is unknown or `{status:"known",epoch,sequence}` from a qualified ordering source. Sequence is meaningful only within its source/epoch; native turn IDs are opaque and not sortable. Admission time and provider time are distinct. A late old-turn observation retains its old turn. Unknown turn/order remains uncertain; arrival or wall time alone cannot prove precedence.

No fresh session evidence for five minutes means uncertain observation, not failure. Collector heartbeats, snapshot reads and browser activity do not refresh session evidence. Restart cannot make old observations current. The state owner implements those rules in Hub #3.

## Events and policy

| Kind | Evidence and intended interpretation |
| --- | --- |
| `session.started` | Session/runtime started, no success or acknowledgment |
| `turn.started` | A new turn, with available identity; retire only notices that policy associates with the previous turn |
| `activity.observed` | Actual session activity, independent of outstanding attention |
| `question.continuing` | A continuing question; `attention` identifies it or explicitly says unknown |
| `attention.input` / `attention.approval` | A blocking input/approval request; neither is a permission decision |
| `attention.resolved` | Only the correlated attention item is resolved; unknown correlation cannot clear all attention |
| `turn.ended` | Retained turn-ended notice; never proof of successful work or readership |
| `turn.interrupted` | Interruption evidence, not successful completion |
| `runtime.ended` | Runtime end, without clearing notices |
| `notice.acknowledged` | Explicit `{consumerId,noticeId}` monitor acknowledgment; no provider-read write |
| `read.observed` | Optional qualified Codex Desktop `read`/`unread` evidence only |
| `evidence.unavailable` | Named dimension and reason `unsupported`, `inaccessible`, `missing`, `ambiguous` or `lost` |

Question and blocked events can coexist. A resolution cannot erase a distinct notice or newer turn. SubagentStart maps to child session start; SubagentStop maps to that child's turn end and does not complete its parent. Child counts require attributable identities and fresh evidence; missing children are not fabricated counts.

The state owner assigns durable notice IDs to accepted notice transitions. Consumers choose their own notice policy, with stable configured consumer IDs. Pixoo dismissal affects its monitor notice only. Nanoleaf retains its existing unread reconciliation and Work/Quiet/Free behavior until a separately selected verified migration. Optional read evidence is unavailable for other paths; absence never means read. A monitor acknowledgment cannot masquerade as `read.observed`.

## Deduplication

Native `eventId`, when supplied by a qualified source, is hashed with the full session selector and turn identity. Its key kind is `native`. Without it, the canonical entire validated envelope is hashed and its kind is `content`. Canonical JSON recursively sorts ASCII object keys, uses compact separators, raw valid Unicode and decimal safe integers. The result is SHA-256 hex. Both consumers execute identical expected fixture hashes.

Generate fallback identity once and keep the whole envelope unchanged on retry, including observation time. Indistinguishable observations can share a content key, so this does not establish exactly-once history or order. Never hash excluded provider content. Different unknown-turn events with reused native IDs also require an explicit uncertainty policy in the future reducer; adapters cannot manufacture a stronger identifier claim.

## Producer delivery requirements

Construct only allowlisted lifecycle fields before serialization, delivery, diagnostics or persistence. Producers must exit successfully and silently on invalid input, timeout, full queue, collector failure or unsupported evidence. They must emit no stdout/stderr, permission decision, additional context or wakeup response to the agent. Monitoring never approves, denies, changes permissions or waits for devices.

Use explicit finite payload, process, queue and deadline bounds, with no unbounded retry. Drop new observations on saturation, retain a bounded loss indicator and expose later evidence loss/resynchronization without logging payloads. Device failures cannot extend producer deadlines. Provider async mode alone does not establish bounded behavior: qualify its process and queue behavior and provide an independent deadline where necessary. Synchronous-only hooks require an explicit bounded path and matched measurements. Disabled/unqualified paths remain silent and do not claim coverage.

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) freezes measured p95/p99, hard timeouts and resource budgets before Hub #3 emitter implementation. This contract supplies no timing results. The cold/warm native Windows, native WSL and selected boundary route profiles must use the actual available paths; absent stages retain acceptance budgets with measurements pending.

## Compatibility and distribution

Run `npm run package:lifecycle` to create an archive and SHA-256 sidecar in ignored `artifacts/`. Its manifest declares artifact/API/schema/fixture versions and every included file hash. `npm run test:lifecycle:package` installs the archive into a temporary external consumer, verifies hashes and executes both full corpora. Keep Python's bundled schema layout intact and install `requirements-contracts.txt`.

Source support is Node 24 and Python 3.12/3.14 on Ubuntu/Windows. This matrix covers portable metadata validation, not installed-provider compatibility. Pins require the archive SHA-256 and reviewed merged-source receipt; a mutable release URL alone is insufficient. A consumer verifies the digest before installation and manifest after extraction. Preserve published bytes; changes get new versions. No sibling checkout imports, provider adapter copies or public registry publication.

Strict schemas reject additive unknown fields. Any new wire field needs an explicitly supported API version; changed meanings or removed/required fields need a new major. Package patch changes cannot alter accepted wire behavior. A failed compatibility check drops monitoring data while preserving the agent's fail-open execution.

## Acceptance evidence map

| Hub #2 criteria | Evidence |
| --- | --- |
| Installed versions, primary sources, Windows/WSL, parent and missing signals | Provider matrix with hashes and stops; live paths remain for #8 |
| Runtime schema, identity, distinct dimensions, privacy | Shared corpus and both validation consumers; malformed/non-JSON privacy checks |
| New/old turns, ongoing questions, blocked/resolved, end/interruption, children, duplicates, missing IDs, late/unsupported evidence | Named shared fixtures retaining those observations without a substitute reducer |
| Labels, notice acknowledgment and optional unread policy | Strict event variants and this policy; legacy Nanoleaf source reference |
| Fail-open bounds and performance inputs | Producer requirements and provider delivery constraints; #30 supplies measured budgets |
| Versioned reusable source and compatibility | Manifest verification, external archive consumers and immutable digest receipt |

Fixture validation does not prove a runtime reducer, installed client, device transport or optical result. Those acceptance layers remain separate.
