# B.U.N.N.Y. event profile 1.0

This is an additive source contract for staged adoption. It defines event records
and reference decisions; no current producer, transport, notification service or
device adopts it merely because its schema validates. Existing
[lifecycle](agent-lifecycle-contract.md), [controller](controller-contract.md)
and [state](../packages/agent-state/README.md) contracts remain authoritative.
[ADR 0010](decisions/0010-shared-event-contracts.md) records the decision.

## Envelope and version registry

The envelope follows [CloudEvents 1.0, specification revision 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
and its [JSON event format](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md).
These official sources were inspected on 2026-10-01. The profile deliberately
accepts a narrower, closed structured-JSON shape. No transport binding is selected.

Required context attributes are `specversion: "1.0"`, `id`, `source`, `type`,
`bunnyprofile: "1.0"`, `dataschema`, `datacontenttype: "application/json"` and
`deliveryclass`. Required `data` contains `evidence` and a registered `payload`.
The only optional context attribute is `time`, a known occurrence timestamp in
canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ` form. If occurrence is unknown, omit
`time`; do not substitute observation, receipt or publication time. The profile
validator checks calendar validity as well as shape.

`specversion` is the CloudEvents wire version, `bunnyprofile` is this profile's
wire version, the immutable `dataschema` identifies the payload version, and the
package version identifies distributed source artifacts. They are independent.
Unknown type/profile/schema combinations fail closed with `invalid-event` before
consumer work. A package patch cannot change accepted wire meaning. Closed
schemas require explicit consumer support for additive wire fields; incompatible
meaning or required fields need a new major. No existing schema is loosened.

Context values use bounded ASCII identifiers and registered URI strings. IDs
are 1–128 letters, digits, underscore, dot or hyphen. Source URNs take the form
`urn:bunny:<owner-family>:<configured-id>`; they contain no address, path or token.
The authentication boundary binds a principal to permitted sources/types. A
syntactically valid URN proves no authority. The registry's owner family is a
coarse validation constraint, not an authorization mechanism.

| Type | Source family / owner | Payload schema suffix / required facts | Delivery class |
| --- | --- | --- | --- |
| `org.bunny.lifecycle.observed` | `provider` / qualified emitter adapter | `lifecycle-observed/1.0`: provider, client, hostId, sourceId, sessionId, lifecycle kind, native identity evidence | current-state |
| `org.bunny.state.changed` | `state` / selected state owner | `state-changed/1.0`: ownerId, revision | current-state |
| `org.bunny.selection.committed` | `hub` / Hub selection owner | `selection-committed/1.0`: selectionId, revision, mode | current-state |
| `org.bunny.controller.outcome` | `controller` / designated controller | `controller-outcome/1.0`: controllerId, deviceId, request epoch/sequence, outcome, priorEffects | current-state |
| `org.bunny.notice.accepted` | `notification` / future accepting owner | `notice-accepted/1.0`: noticeId, acceptanceId, policyId | actionable-notification |
| `org.bunny.effect.available` | `automation` / future authorized policy evaluator | `effect-available/1.0`: effectId, policyId, notBeforeMs, expiresAtMs | time-sensitive-effect |

Schema URIs use `https://bunny.invalid/events/<suffix>`. They are immutable
identifiers resolved from the bundled registry, never fetched from the network.
Reserved `.invalid` avoids implying a deployed schema service. Registry entries
are definitions, not proof that a corresponding runtime publisher exists. The
lifecycle entry is a minimal observation summary, not a lossless replacement
for lifecycle 1.0/1.1. An adapter must preserve the authoritative lifecycle record
and reject a mapping that would discard required attention, parent, turn or
ordering evidence; a richer projection needs a separately versioned payload. The
selection example anticipates the saved selection owner; it does not implement
or select its policy. Effect availability records an eligible fact; it is not a
device command and supplies no arbitrary destination or command payload.

## Evidence, identity and relationships

The retry key is the exact pair `(source, id)`. The producer assigns the record ID
once and preserves the complete record on retry. Same pair/different content is
a conflict, never a replacement or second action. Comparison ignores JSON object
key order. Deduplication must cover the accepting owner's declared retention
scope, not a presumed global history. Evicted identities cannot silently acquire
an exactly-once guarantee.

`data.evidence` carries `observedAtMs` and optional `receivedAtMs` as nonnegative
safe-integer wall-clock milliseconds. Receipt belongs to the named producer's
boundary and is fixed when that record is created. An intermediary must not
rewrite it during retries. Neither clock supplies ordering evidence.
`occurrence` is `known` only when `time` is present; otherwise it is `unknown`.

`ordering` is `{status:"unknown"}` or
`{status:"known", authority:<source URN>, epoch:<ID>, sequence:<safe integer>}`.
Compare sequence only within the same authority and epoch. An owner revision
orders that owner's commits; it is not provider occurrence order or a global
cross-controller order. Revisions remain valid through `9007199254740991` inside
JSON `data`. CloudEvents context Integer has a signed 32-bit range, so revisions
are never integer context extensions.

`correlation` and `causation` each use `{status:"unknown"}` or
`{status:"known", source:<source URN>, id:<ID>}`. A qualified reference identifies
a record, not a coincident timestamp, title or local counter. Causation cannot
refer to the record itself. Correlation groups an established operation; it
never merges agent sessions or grants command authority. Missing native provider
identity is explicit in the lifecycle payload. A locally assigned event record
ID does not fill it, establish parentage or manufacture native ordering. Adapters
must reject unsupported mappings visibly at their own boundary while hooks
continue to fail open.

## Bounds, privacy and authorization

Profile records are at most 16 KiB of UTF-8 JSON, depth 12 and 512 JSON nodes.
No unbounded arrays, binary payloads, arbitrary extension objects, raw commands,
URLs, credentials, tokens, paths, prompts, transcripts or provider records are
accepted. Scalars/counters have schema bounds and non-JSON values are rejected.
Errors expose a fixed code, not raw values or validator diagnostics. Transport
adopters must enforce the byte limit before parsing and the structural limits
before schema traversal. In-memory validation alone cannot bound network intake.

These limits apply to the new profile, not to existing lifecycle/controller
limits. Existing safe-integer revisions are preserved. A secret encoded in a
permitted neutral identifier cannot be detected by schema shape; producers must
select allowlisted, policy-approved fields. Session display metadata remains
under its existing versioned contract. Content capture remains separate.

Authenticate and authorize before admission, replay lookup or publication. A
read credential never commands a controller; a browser credential never silently
becomes a machine credential. Revocation, loopback/origin checks and private
configuration remain with each existing route. Subscribers cannot select arbitrary
hosts, device IPs or private databases. Each source and state store has its named
owner; every device effect goes through its designated controller queue.

## Delivery and enforcement

| Class | Required behavior | Enforcement owner and evidence limit |
| --- | --- | --- |
| Current-state | Coalesce pending updates; reconnect/overflow retrieves the authoritative latest snapshot. Retain recovery polling. Never replay effects from old notices. | State owner publishes committed facts; transport isolates consumers; each consumer reconciles its projection. Schema/reference checks cannot prove the deployed path. |
| Actionable notification | Promise recoverability only after a confirmed durable accepting commit. Accept duplicates without repeated action. Preserve pending/failed/recovery state until handled or explicitly expired under a selected policy. | Future accepting owner and its durable storage enforce acceptance, retention and saturation; authenticated consumers enforce idempotent handling. No current general service is claimed. |
| Time-sensitive effect | Admit only within a declared validity window and current authorized policy. Restart/reconnect/history is never a trigger to replay it. | Policy evaluator decides eligibility; controller validates current generation/mode and admits once. Transmission evidence remains distinct from physical effect. |

Every runtime adopter must publish finite admission count/byte limits, consumer
capacity, retry count/deadline and deduplication retention. Unknown limits block
its claimed guarantee. Current-state overload may discard intermediate states,
record loss and resync. Actionable saturation must reject *before* durable
acceptance or retain accepted items in observable pending/failed state; it must
not evict accepted unhandled items to make room. Retry scheduling must be bounded
and isolated per consumer so a slow destination cannot block hooks or healthy
consumers. Exhausted automatic attempts leave a visible recoverable item; they
are not acknowledgment or silent expiry. Numeric service policies remain unchosen.

A transport delivery acknowledgment means a consumer received a record. Human
handling, optional readership and explicit policy expiry are separate facts.
Expiry must name its policy/reason and cannot claim handling, successful work or
readership. A failed/ambiguous durable commit is not confirmed acceptance. Hooks
remain best-effort, bounded and fail-open even if a downstream service eventually
provides durable accepted-item recovery. There is no lossless upstream capture or
exactly-once end-to-end claim.

## Current interface inventory

Inspection baseline: Hub `a0bb44ababf9cb30a6ee6df7ff14b2e5ee1d7949`,
Nanoleaf `f0f0a57de555bdfc2ec040e105399ba0cf277d2b`, and Pixoo
`9c84321280ac6e1a478c348cbf9d40621c5f46e7`, read 2026-10-01. These are source
observations, not installed/runtime qualification. “Compatible” means the
interface may remain unchanged alongside the profile, not that it accepts a
CloudEvent. “Adapter-needed” requires an explicit opt-in projection and consumer.
“Scoped adoption needed” requires a selected feature and its owning policy.

| Interface and source | Producer → consumer; owned fact/kind | Version, authority and order | Bounds/recovery/delivery | Classification and concrete adoption |
| --- | --- | --- | --- | --- |
| [Provider normalizers/emitter](../packages/agent-state/src/providers.ts), [hook](../packages/agent-state/bin/hook.mjs) | Codex/Claude signal → state owner; observation, not command | Lifecycle 1.0/1.1, qualified provider/client/source/session; native order only when evidenced | Existing hook/admission bounds, silent fail-open and loss counters; best-effort latest-state intake, no durable hook guarantee | Adapter-needed: map only qualified allowlisted evidence to lifecycle-observed; retain native format and current provider qualification |
| [State intake/storage](../packages/agent-state/src/index.ts), [Hub storage](../apps/hub/src/storage.ts) | Selected owner → committed state; one reducer and private store | State package 3.3.0, store 2.1; owner safe-integer revision after atomic CAS commit | 128 sessions, 128 pending, 3 s storage deadline; fault on ambiguous commit, load committed revision on restart | Adapter-needed: state-changed after confirmed commit, consumer still retrieves version-selected snapshot |
| [State subscriptions](../packages/agent-state/src/subscriptions.ts) | Owner → configured consumers; revision pointers/resync | Owner revision, no provider-order claim | Per-consumer bounded queue, overflow resync; no effect replay | Compatible unchanged; optional event adapter must retain isolation and snapshot recovery |
| [Hub monitor HTTP/SSE](../apps/hub/src/server.ts) | Owner → dashboard/status readers; current snapshot and change notices | Monitor API 1.0; snapshot 1.0/1.1/1.2; read auth, owner identity; SSE epoch/sequence separate from state revision | 16 streams, 32 retained notices, 1 s tick, slow-write disconnect after 5 s; resync and heartbeat; latest-state | Adapter-needed only for future event wire; existing-wire subscription work remains native SSE with recovery polling |
| [Dashboard](../apps/dashboard/README.md) and [Hub command routes](../apps/hub/src/server.ts) | Explicit user operation → owning service; command and receipt, not committed event | Same-origin/browser session and control scope; issued request identity, replay and revision guards | Bounded bodies, retained outcomes; no automatic write retry | Compatible unchanged; publish a separate committed fact only after owning mutation succeeds |
| [MCP](../apps/hub/src/mcp.ts) | Authenticated model client → same owning services; deliberate command/read | MCP tool schemas plus controller 1.0/application extensions; principal device/read/control scopes | Existing bounded handler, request replay; uncertain write outcome is retained | Compatible unchanged; no event envelope replaces tool authorization or receipts |
| Hub saved selection / automation | Future selected policy owner → controller dispatch; committed selection versus independent outcomes | Selection owner is [#695](https://github.com/jimmie-potts/agent-device-hub/issues/695); dispatcher [#67](https://github.com/jimmie-potts/agent-device-hub/issues/67) | Policy-owned bounded dispatch; remember selection, send no commands on restart | Scoped adoption needed: after saved selection commit emit selection-committed, correlate independent controller receipts; no implementation asserted |
| [Local controller host](../apps/local-controllers/README.md) | Hub → in-process LIFX/Tidbyt owners; API routing/receipts | Controller 1.0, machine credential scopes and leases; per-device request/generation identity | Loopback listener, private config, existing replay/queue limits and graceful shutdown | Compatible unchanged; adapter would publish each controller's outcome after its actual result |
| [LIFX](../controllers/lifx/README.md) | Shared status/explicit control → per-bulb writer; desired state, transmission and observation distinct | Controller 1.0, lifx-light 1.0.0; mode/generation and qualified model checks | Queue default 8, receipts 256; transition-only no-power status, no new paint on unavailable feed; 30 s recovery poll | Adapter-needed for outcome events; subscription adoption preserves manual control and queue ownership |
| [Tidbyt](../controllers/tidbyt/README.md) | Shared status/playback → renderer → one cloud writer | Controller 1.0, internal tidbyt-display 1.2.0; configured installation and queue | Queue default 8, existing cadence/backoff and 15 s minimum status interval; stale display on feed loss | Adapter-needed for outcomes; repeated notices cannot bypass write gate or create a second writer |
| [Nanoleaf shared input](https://github.com/jimmie-potts/codex-nanoleaf/blob/f0f0a57de555bdfc2ec040e105399ba0cf277d2b/bridge/shared_input.py) | Selected Hub snapshot → Python presentation worker | State 3.3.0 artifact; snapshots 1.1/1.2 require generations, selected owner and nondecreasing revision | 16 MiB response, 2.5 s reads, explicit shared/legacy selection; preserves Work/Quiet/Free/unread/epochs | Adapter-needed for new envelope; add Python consumer negotiation while preserving explicit cutover and worker ownership |
| [Nanoleaf controller/integration](https://github.com/jimmie-potts/codex-nanoleaf/blob/f0f0a57de555bdfc2ec040e105399ba0cf277d2b/bridge/controller_server.py) | Hub/native clients → Python queue; controller receipt/observation, spatial operations separate | Controller 1.0 and device integration profile; existing machine auth and origin checks | Owning queue, replay/generation and feed resync; no snapshot/transport claim of optical success | Compatible unchanged; explicit outcome adapter must preserve task/effect epochs and reservations |
| [Pixoo monitor source](https://github.com/jimmie-potts/divoom-app-upgrade/blob/9c84321280ac6e1a478c348cbf9d40621c5f46e7/apps/server/src/monitor-source.ts) | Embedded or explicitly selected remote owner → monitor renderer | Pinned state 3.3.0/lifecycle artifacts; selected owner, snapshots and consumer acknowledgment | Current state recovery and stale indication; collection independent of Monitor/Media | Adapter-needed: preserve selected owner, snapshot versions and consumer-only dismissal; no second reducer |
| [Pixoo controller/player](https://github.com/jimmie-potts/divoom-app-upgrade/blob/9c84321280ac6e1a478c348cbf9d40621c5f46e7/docs/hub-controller-api.md) | Hub/UI/MCP → existing player/device writer; commands/receipts/observations | Controller 1.0 plus native application schemas; issued tickets, epochs and revisions | Bounded replay/feed, one writer, simulator startup, paused playback recovery and referenced rendition protection | Compatible unchanged; outcome adapter must not replay media/effects during snapshot recovery |
| [Sony](../apps/hub/src/sony.ts) / [Sonos](../apps/hub/src/sonos.ts) playback adapters | Vendor observations → [playback owner](../apps/hub/src/playback.ts) → dashboard/Tidbyt | Native JSON-RPC / UPnP SOAP; playback snapshot API 1.0, configured endpoints; observation time is not track-change native identity | 64 KiB replies, bounded reads, default 2 s polling; 5 s stale/30 s unavailable; commands sent once, uncertain timeout not retried | Compatible unchanged; future typed playback event needs its own payload and evidence rules, not invented track identity/order |

The inventory does not make every interface a publisher. Existing bounds remain
with their owning contracts; none is enlarged by the new profile.

## Reference traces

The shared corpus in `packages/event-contracts/fixtures/events-v1.json` contains
these inspectable examples. `validateEvent`/`validate_event` check records;
`referenceDecision`/`reference_decision` check the supplied evidence and return
pure decisions. They neither mutate a ledger nor submit a device command.

1. **Hook intake:** a qualified adapter receives a start, selects allowlisted
   fields and assigns a local record ID. `lifecycle.observed` preserves unknown
   native identity, occurrence and order. `hook-intake-is-not-durable-notification`
   requests current-state reconciliation. The hook can still be lost before owner
   intake; the owner, not this trace, decides and commits its reduction.
2. **Dashboard command to selection:** the existing authenticated command path
   validates authority and request identity. A future saved-selection owner
   commits its selection/revision, then publishes `selection.committed` with a
   qualified correlation/causation reference. `committed-selection-is-not-dispatch`
   reads current state; publication or reconnect is not permission to dispatch.
   A failed commit emits no committed-selection event. This profile does not
   implement that producer or invent a command/event transaction.
3. **Independent controllers:** after explicit authorized dispatch, LIFX's
   `controller.outcome` may report `sent`/`confirmed-transmission`; Tidbyt's
   independent record may report `failed`/`none`. `independent-controller-failure`
   identifies a separate fact, and `controller-receipt-is-not-physical-proof`
   requests reconciliation without asserting optical success or undoing the
   saved selection. Each controller owns its request queue and outcome.
4. **Status recovery:** after a cursor gap, `status-reconnect-reads-latest` returns
   `read-snapshot`. The actual selected owner supplies the snapshot; the consumer
   replaces its projection. Intermediate notices may have coalesced. No complete
   history or old effect is reconstructed. `effect-reconnect-never-replays` returns
   `no-replay` even for a currently valid window; a fresh authorized decision is
   separate. Window-start/expiry boundary fixtures preserve that distinction.
5. **Notification recovery:** `notice-unconfirmed`, `notice-failed` and
   `notice-ambiguous` yield `unconfirmed`. A confirmed accepting commit permits
   `notice-confirmed-first-delivery`; restart yields `notice-restart-after-acceptance`.
   `same-notice-retry` is a duplicate, while `same-identity-changed-body` conflicts.
   A consumer must consult its own durable handling record before repeating an
   action. `delivery-ack-is-not-handling` waits for handling and
   `delivery-ack-retains-recovery` retains the obligation. `handled-is-distinct`
   and `explicit-expiry-is-distinct` end it for different evidenced reasons.
   Only a future qualified accepting owner/store and consumer can enforce this
   across crashes; supplying `confirmed` in a fixture proves no real commit.

## Retained-notice recovery and refinement proposal

The existing owner creates stable turn-ended notice IDs in
[reducer.ts](../packages/agent-state/src/reducer.ts), records per-consumer
`acknowledgedBy`, and persists the changed session before publishing a revision.
[HubStorage](../apps/hub/src/storage.ts) uses a private Linux SQLite store,
exclusive owner lease, revision comparison, transaction and `synchronous=FULL`.
A fresh snapshot after restart recovers whichever atomic state committed. Storage
failure or ambiguity faults the owner rather than publishing speculative state.
This supports recovery of currently retained notices under that owner's policy;
it does not prove filesystem/power-loss behavior for an unqualified installation.

| Existing guarantee or limit | Consequence for actionable notification delivery |
| --- | --- |
| Current notices survive journal pruning; journal is newest 10,000 summaries within 24 h | Diagnostic history is separate and cannot rebuild lost upstream events |
| Per-consumer acknowledgment is committed and idempotent | A monitor dismissal is not transport receipt, human readership or approval resolution |
| `clearOnNewTurn` can mark prior known-turn notices acknowledged for configured consumers | This display policy cannot silently become the handling policy for actionable items |
| Session expiry after 24 h without lifecycle evidence removes notices; accepted runtime end removes session tree and notices | Accepted actionable items needing longer recovery require a separate lifetime from session presence |
| 128 notices per session; overflow rejects the incoming reduction and increments loss | No unlimited retention; saturation before a promised acceptance must be visible |
| Bounded retry keys/watermarks and stable known-turn notice identity | No lossless capture or universal exactly-once identity, especially unknown-turn/unqualified sources |
| Snapshot resync recovers surviving current notices, not a durable per-destination delivery queue | No general pending/retry/failed delivery ledger or distinct transport acknowledgment exists |

Proposed refinement scope: first assess an extension at the existing state owner's
commit boundary, with its storage owner, before proposing another service. Produce
one design/acceptance proposal for a bounded recoverable actionable-item ledger,
if its owner selects that work. The proposal must answer these concrete choices;
this profile does not choose them:

1. **Supported sources:** choose the initial allowlist and qualification evidence.
   Candidate inputs are confirmed owner-created retained notices, not all raw
   hooks. Define how sources without stable native identity expose uncertainty.
2. **Retention/expiry:** decide whether accepted actionable items outlive session
   retirement, their time/count/byte limits and explicit expiry authority/reason.
   Define restart and clock-discontinuity behavior. Preserve current monitor policy.
3. **Acknowledgment:** choose permitted consumers/actors, separate delivery receipt
   from handling/read evidence, and specify idempotent guarded acknowledgment.
   Decide whether handling is per consumer or shared; do not infer it from display.
4. **Capacity/retry:** select finite capacity, rejection semantics before acceptance,
   retry schedule/attempt bound and observable failed/pending recovery. Never silently
   evict an accepted unhandled item or make provider hooks wait for destinations.
5. **Recovery:** specify acceptance receipt, lost-response reconciliation, durable
   deduplication scope, atomic commit/restart tests and slow-consumer isolation.
   Demonstrate that expiry, duplicate delivery and recovery cause no repeated action.

The refinement's acceptance examples must cover a commit followed by a lost
response, restart before first delivery, duplicate receipt, consumer outage,
saturation, session retirement, explicit expiry and ambiguous storage failure.
Choose extension versus separate service only after those requirements expose a
concrete gap. Reliable complete history remains [#139](https://github.com/jimmie-potts/agent-device-hub/issues/139).
No notification implementation or future owner policy is selected here.

## Rule-to-evidence map

| Rule | Required evidence |
| --- | --- |
| Context/type/version, payload allowlist and safe counters | Profile schema and positive/negative shared validation corpus |
| Stable identity, qualified references, unknown order/time | Semantic validation and reference fixtures, plus adoption-time source qualification |
| Status coalescing/resync versus history | Snapshot recovery trace and pure decision fixture; consumer adoption tests remain required |
| Confirmed durable acceptance, duplicate delivery, handled/expired distinction | Notification recovery trace/reference fixtures and assessment above; real storage/delivery remains future work |
| Live-only validity, no replay and independent controller outcomes | Effect/outcome traces and reference fixtures; actual controller queue/mode/generation tests at adoption |
| Byte/depth/node, privacy, authorization and isolation | Validator negative cases; authenticated transport/intake/queue enforcement belongs to adopter |
| Released compatibility | Unchanged vendor artifacts, lifecycle/controller package checks and affected current consumer suites |

Fixtures demonstrate contract/reference behavior only. They cannot establish
installed producers, durable service availability, runtime superiority, real
client acceptance, visible device timing or physical accuracy.
