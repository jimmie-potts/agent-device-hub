## Context

Source references are to main `16a9f698`. Each implementing pull request rechecks them.

One hook event passes through six shapes today:

| Shape | Where it is made |
| --- | --- |
| Hook JSON | the client, read by `runHook` (`apps/runtime/src/hook/hook.ts:74-84`) |
| Lifecycle 1.x envelope | `normalizeHook` and `enrichHook` (`packages/agent-state/src/providers.ts:46`, `:108`), imported at `hook.ts:6` |
| `lifecycle/2.0` observation | `observationOf` (`apps/runtime/src/hook/observation.ts:48`), published once with no retry (`hook.ts:91`) |
| Lifecycle 1.2 envelope | `toEnvelope` (`apps/runtime/src/core/mapping.ts:65`), called at `core.ts:767` |
| agent-state 1.x `Session` | `reduceSession` (`packages/agent-state/src/reducer.ts:77`) inside agent-state's owner (`packages/agent-state/src/index.ts:265-317`) |
| `session/2.0` record | `project` (`mapping.ts:150`), diffed against the last record (`mapping.ts:157`) |

The core runs agent-state's owner (`core.ts:561`) on the core store, which implements agent-state's `Storage` (`apps/runtime/src/core/store.ts:189`). The store keeps the owner's whole durable state as one JSON row in the table `state` (`store.ts:443`). It reconstructs what caused each commit (`store.ts:780`) and derives occurrences by comparing states before and after (`store.ts:687-777`). Both owners keep a revision. The record's `generation` comes from agent-state's revision (`index.ts:306`). The five-minute rule exists twice (`packages/agent-state/src/types.ts:7`, `packages/event-contracts/src/v2/families.ts:35`), and the profile validator enforces it on every `session/2.0` record (`families.ts:262-267`). Child counting is copied (`mapping.ts:134`). Restart uncertainty lives in memory in both owners (`index.ts:94`, `store.ts:502-505`). Agent-state's expiry timer uses `setTimeout`, outside the runtime's scheduler (`index.ts:113-121`).

The store takes its lock, checks the stored `ownerId`, creates every core part's tables and loads its caches only inside `acquire`, which only agent-state's owner calls (`store.ts:357-372`, `:424-437`). Two other layers already keep one writer. The runtime takes the existing lease on `modules/core.sqlite-owner` without waiting before the core starts (`apps/runtime/src/runtime-ownership.ts:44-62`), and the store borrows it (`runtime-ownership.ts:90-96`). The SDK opens every module database with `locking_mode = EXCLUSIVE` (`packages/sdk/src/database.ts:43-46`).

Readers interpret `freshness` and `restartUncertain` in their own ways. Examples are the Tronbyt tile (`modules/tidbyt/src/status.ts:82`), the Pixoo marker (`modules/pixoo/src/presentation/agent-dashboard.ts:84`), Nanoleaf's stale rule (`modules/nanoleaf/src/shared-input.ts:436`, `:556`), the companions (`modules/companions/src/presentation-policy.ts:11`, `:33`), the robots (`modules/microduck/src/module.ts:156-159`, `modules/reachy-mini/src/module.ts:142`), the core's opportunity admission (`apps/runtime/src/core/companion-part.ts:90`), the dashboard (`apps/runtime/dashboard/src/sessions.ts:103`, `habitat/session.ts:42-43`, `operator-tools.tsx:26`) and the assistant's `read_sessions` (`modules/companions/src/assistant/tools.ts:60`).

## Goals and non-goals

Goals:

- One flat path with one owner: adapter, then observation, then the core's transition, then a stored session whose public part is the record.
- One hub-computed status that every reader takes from one shared read function, and one shared synthetic case set that holds them to it.
- A record that later work extends in one place: a source in the supported-source definition, a detail token, or a claim.
- Every merged step leaves main installable and the runtime working.

Non-goals:

- No change to the retained 1.x packages (`packages/agent-state`, `packages/lifecycle-contracts`, `packages/agent-status`) or to their legacy consumers. #839 owns their retirement.
- No new message format, transport, retry policy, polling path, event sourcing, provider registry service or second state owner.
- No migration of old session data, no compatibility record for older read helpers, no reset marker, no stored run epoch and no store start-up step of its own. These follow the owner's 2026-11-18 decisions.
- No new progress mapping. Qualified Codex Mac progress is #1867, native assistant tasks are #505 and title refinements are #1868.

## Decisions

### 1. The flattened path

```text
hook JSON or a native producer
  -> lifecycle/2.0 observation   built by the adapter
  -> transition(stored, input)   one function in the core
  -> stored session              public record plus private bookkeeping, in core tables
  -> session/3.0 record          the public part, published in the commit
```

- The hook adapter moves into `apps/runtime/src/hook/` (step 2). It builds the observation directly and drops `observationOf`. Its output is byte-identical to today's for every hook, producer file and lifecycle version, title enrichment included. The runtime copy of the normalizer and title reader replaces the import of `@jimmie-potts/agent-state/providers`. The retained package keeps its own copy for `apps/hub`.
- The session logic moves into a new folder, `apps/runtime/src/core/session/`. It takes observations, not envelopes (step 7). This is a port of agent-state's reducer, retirement, child counting, approval recovery, title, label and acknowledgment operations, archived-session admission and 24-hour expiry. The rules carry over unchanged unless a later decision here changes them. Expiry and deadlines run on the core's scheduler and injected clock, not `setTimeout`.
- The stored session is the public record plus private bookkeeping: ordering watermarks, seen content keys, retired turns and the private progress time (decision 5). Session rows live in core tables in the same step. The projection step and `mapping.ts`'s child-count copy disappear. The reducer writes the public shape.
- No new message format is added. Adapters keep producing `lifecycle/2.0` (and `lifecycle/2.1` for read receipts). The only new document is the `session/3.0` state record of an existing family.

### 2. One supported-source definition

`packages/event-contracts/src/v2/sources.ts` defines each supported source once: its provider, its clients and, for hooks, the hook names it maps. Today's values are Codex with `cli`, `desktop` and `local`, and Claude with `code`. The `Identity` type, the `session/3.0` and `lifecycle` schema enums, the runtime hook adapter's source check and the `provider` filter of the `core_sessions` MCP tool (`apps/runtime/src/core/core.ts:178`) derive from it. A contract test fails if any of the schema enums differs, and step 5 derives the tool's filter from the definition. The retained 1.x lists (`packages/lifecycle-contracts`, `packages/agent-state`) stay as they are.

Capability facts are design inputs and stay in `docs/provider-qualification.md`. Each source records documented support, implemented mapping and actual qualification separately. Today Claude maps SessionStart, UserPromptSubmit, PermissionRequest, PostToolUse and PostToolUseFailure, Stop, SessionEnd, SubagentStart and SubagentStop (`providers.ts:31-34`), and nothing emits `activity-observed`. The Mac Codex wrapper forwards root SessionStart (not `compact`), UserPromptSubmit, Stop, Interrupt and SessionEnd, and drops child payloads (`apps/runtime/bin/mac-codex-hook.mjs:6-18`). It therefore reports no approval, no tool result and no subagent. Codex Desktop adds module metadata and read evidence (`modules/codex-desktop/src/evidence.ts:20-38`). No installed parity is claimed.

A new source is a minor version of the session family under ADR 0012's `<family>/<major>.<minor>` rule. Its readers update in the same batch. #505 adds the native assistant this way.

### 3. The `session/3.0` record

`session/3.0` is a new major of the `session` family, registered beside `2.0` and `2.1` in step 1 and published by the core only from step 9. The names below are design names. Step 1 settles the exact schema mechanics and updates this design if they move.

| Member | Meaning |
| --- | --- |
| `id`, `revision`, `generation`, `identity`, `parent`, `turn`, `ordering`, `observedAtMs`, `lastEvidenceAtMs`, `label`, `title`, `project`, `projectId`, `hostSessionId` | As in `session/2.0`. `lastEvidenceAtMs` is the evidence time of the last published change (decision 5). |
| `status` | `{class, detail}`. `class` is a closed enum: `needs-owner`, `working`, `finished`, `quiet` or `unknown`. `detail` is an open kebab-case token. |
| `work` | `{state, confidence, evidenceAtMs, reasons}`. `state` is `active`, `idle`, `interrupted` or `unknown`. `confidence` is `confirmed` or `unconfirmed`. `reasons` lists why it is unconfirmed: `deadline`, `restart`, or an `activity` unavailable reason. |
| `attention` | `{items, confidence, evidenceAtMs}`. `items` keeps today's attention items. |
| `outcome` | `{notices, read, readReceipt, confidence, evidenceAtMs}`. It keeps today's notices with per-consumer acknowledgments, read evidence and receipt provenance (`session/2.1`). |
| `relationships` | `{children: {working, unconfirmed}, confidence}`. A child counts as working only while its own work claim is active and confirmed. Activity it cannot attribute counts as unconfirmed. |
| `unavailable` | Today's dimension and reason list, so unsupported, missing, inaccessible, ambiguous and lost stay distinct. A claim's `confidence` is `unconfirmed` when an `ambiguous` or `lost` entry exists for its dimensions, and for work also after a deadline or restart. |

The core computes `status` with one pure function from the claims. It lives in the contracts package and the shared read function uses it too. The first rule that matches wins:

1. Attention items present: `needs-owner`, with the highest-ranked kind as detail (`approval`, then `input`, then `question`, as `apps/runtime/dashboard/src/sessions.ts:56` ranks them).
2. Work active: `working`, detail `confirmed` or `unconfirmed`. Otherwise a working child: `working`, detail `subagent`.
3. A notice still describes the finished turn: `finished`, detail `turn-ended`. The class ignores acknowledgments and read evidence. #505 adds details such as `failed` and `cancelled` without a schema change. Which notices count goes to the owner (see "Rule 3 pending the owner" below). Until the answer, one function, `noticeCounts`, applies the dashboard's rule: a notice counts unless a known later turn superseded it.
4. Work idle or interrupted: `quiet`, detail `idle` or `interrupted`.
5. Otherwise `unknown`, with the activity's unavailable reason as detail, or `unknown`.

A reader switches on the class and may use the detail. A detail it does not know falls back to its class. Unknown action semantics never grant eligibility (decision 10). Per-consumer acknowledgment stays on the record. The shared read function applies each reader's own acknowledgment and read policy to retire `finished` to `quiet` for that reader (detail `acknowledged` or `read`).

The `session/3.0` validator keeps today's record checks: entity ID, parentage, ordering authority, unique notices and dimensions, generation not after revision, and receipt provenance on an idle or interrupted root's current turn. It drops the freshness check and adds the status check: `status` must equal the function of the record's claims.

Step 1 settled the schema mechanics as follows:

- The record type is `Session30Record` (`families.ts`), and `schemas/v2/families/session.3.0.schema.json` defines its own identity and building blocks, so a later minor can widen the identity alone.
- `status.detail` uses the blocks' kebab-case `enumValue`. Because the validator requires the status the function gives, a detail the function never gives is refused. A reader therefore meets an unknown detail only from a newer function than its own, and the case set exercises that fallback on the view.
- `work.reasons` holds `deadline`, `restart`, `ambiguous` or `lost`. Confirmed work has no reason, and unconfirmed work has at least one. A claim's dimensions are: work, `activity`; attention, `attention`; outcome, `read`; relationships, `parent`.
- Rule 3 and each reader's retirement use the notices `noticeCounts` keeps. `finished` retires to `quiet` with detail `acknowledged` once each of them is acknowledged under the reader's policy, or with detail `read` when read evidence counts for that reader and the outcome is read.
- Read provenance makes the outcome `read` and requires a known turn, idle or interrupted work and a root. Without provenance, only Codex Desktop records read evidence.

**Rule 3 pending the owner.** The design's first wording, "the latest notice belongs to the current turn", hides a recorded outcome whenever turn evidence is missing or conflicting. Today's reducer produces such records: a Stop for a turn whose prompt start was lost (both notices kept, the turn ambiguous), a Stop without a turn ID after a known running turn, and a notice with an unknown turn followed by a next turn that starts and is interrupted. The 1.x helper, LIFX, the Tidbyt tile and the dashboard's `finishedUnread` (`apps/runtime/dashboard/src/sessions.ts:66-69`) all show these as finished, and that wording would not. The owner decides the rule. The coordinator's recommendation, applied until then, is the dashboard's: a notice counts unless its turn and the session's turn are both known and differ. Under it the view agrees with the 1.x helper for every case in the case set and differs only where a known later turn superseded an unacknowledged notice, which the core acknowledges for Nanoleaf and Pixoo at that turn's start. `noticeCounts` is the one place to change if the owner chooses otherwise. The live helper in `status.ts` keeps today's rule in group 1 (decision 10). The copied 1.x cases in `status.test.mjs` place their notices on a known turn other than their record's, so they pass against `status.ts` but would rank differently over the view; the step that moves a live reader onto the view revisits that scenario with the owner's answer.

### 4. Aging, restart and clocks

The core owns every time-driven change of meaning and publishes it. One aging table holds a row per claim:

| Claim | Silence | Restart |
| --- | --- | --- |
| Work, active | `unconfirmed` (reason `deadline`) five minutes after its private progress time | `unconfirmed` (reason `restart`) at start |
| Work, idle or interrupted | no change | no change |
| Attention | no change | no change |
| Outcome | no change | no change |
| Relationships | follow each child's work claim | follow each child's work claim |
| Whole session | removed as `expired` after 24 hours without lifecycle evidence | kept |

- Only qualifying evidence for the current turn confirms work again: `turn-started`, `activity-observed`, or `attention-resolved` on the current turn (today's Claude tool-result evidence, `providers.ts:72-77`). Evidence for a retired or other turn never confirms. #1867 refines qualification.
- After a restart, evidence whose producer instant precedes the core's start instant does not confirm work. The core holds that instant in memory. No run epoch is stored. For in-process producers, such as a native module's outbox republication, the producer and the core share one clock, so the rule is exact. A remote host's clock can differ: a clock that runs behind delays confirmation until the next evidence, and one that runs ahead could let an event sent before the restart but delivered after it confirm work. Hooks publish once within their 3-second budget and never retry, so such a delayed hook event is rare and bounded by that budget. This limit is accepted rather than adding a run epoch.
- Deadlines and expiry use the core's clock, at the core's receipt of evidence, as `lastEvidenceAtMs` does today (`index.ts:110`, `reducer.ts:201`). Host instants stay evidence fields for session state. The companion question window is the one exception and keeps the host's clock, as decision 10 states.
- At start, one core transaction marks every stored active work claim `unconfirmed` (reason `restart`) and publishes the changed records. It emits no occurrence. Questions, recorded outcomes and read evidence stay as stored.
- Explicit uncertainty, such as lost or conflicting evidence, publishes at once.

Until step 9 the core still publishes `session/2.x`, whose validator enforces the five-minute freshness rule. Steps 7 and 8 therefore keep today's republication at five minutes. From step 8, `restartUncertain` is true only for sessions whose work claim the restart made unconfirmed. The shared read function maps `session/2.x` to the same claims: active work is unconfirmed while `freshness` is `uncertain` or `restartUncertain` is true, and while an `ambiguous` or `lost` activity entry exists, with that entry's reason after any `deadline` or `restart`. Children map as `working = children.active` and `unconfirmed = children.uncertain`. Every claim takes the record's `lastEvidenceAtMs` as its evidence time, and ambiguous or lost evidence marks the attention, outcome and relationship claims by their dimensions too. A waiting session whose turn is still running under its question therefore keeps `needs-owner` while its work becomes unconfirmed.

### 5. The transition result and publication

`transition(stored, input, nowMs)` is pure. Its inputs are an observation, an acknowledgment, a notice override, a label, a title, an approval recovery, a read receipt, a due deadline, a start or an expiry. It returns:

- every changed stored session, including affected parents and descendants;
- every removal with its reason (`expired` or `retired`) and the retirement guards it leaves;
- the occurrences in order (`attention-raised`, `attention-cleared` with its cause, `turn-ended` naming the notice, `session-ended` before a runtime end's removals), with exactly today's payloads and order;
- the next deadline.

The store commits the result in one transaction through the existing outbox, with history, the intake's `(source, id)`, the core's revision and part derivers (`store.ts:557-684`). It no longer reconstructs causes (`store.ts:780`) or derives occurrences by comparing states. The shared transaction, history and outbox machinery stays.

Private progress can change without a public revision. From step 9 a work observation that changes no public member only advances the private progress time and re-arms the deadline. It writes the stored session, publishes nothing and adds no history row. Any change of public meaning publishes at a new revision and history keeps it. Confirmation changes count as meaning. A record's public `lastEvidenceAtMs` is therefore the evidence time of its last published change. The Tronbyt tile and Habitat keep ordering by it (`modules/tidbyt/src/status.ts:64`, `habitat/session.ts:31`). Before a sync the core commits any transition that is due, so a revision always names one payload. Bindings that compare revisions exactly keep working (`operator-tools.tsx:27`, `suggestion-model.ts:33`, `presentation-policy.ts:29`). There is no one-minute publication throttle. The existing save-cost and hourly history checks stay.

### 6. Root starts (#397)

The session-start handler follows the accepted policy (step 8):

- A `session-started` observation for an unknown root creates the record with work `idle` and no work turn. The turn it carries, such as a SessionStart `prompt_id`, selects no work turn.
- For a known root it preserves work state and the current turn. Mid-turn compaction keeps the active turn, and a stale or conflicting start cannot replace a newer evidenced turn or restore a finished one.
- A child start (SubagentStart) keeps today's meaning: evidenced child work under its known parent.
- `turn-started` and qualifying activity remain work evidence.
- The rule applies to Codex roots too, because their SessionStart is also not work. Codex's first event arrives with its first prompt. The Mac Codex path cannot exercise compaction, because the wrapper drops `compact`. That provider difference is recorded and not tested on that path.

The correction is in the core, so it also applies to observations from older hooks.

### 7. Session capacity

The core ports the 128-session limit (`types.ts:8`) and its eviction rule (`index.ts:286-305`) deliberately:

- The limit counts every stored session, root or child, from any source.
- At the limit, a new child is refused.
- A new root may displace one child subtree. Every member of that subtree must be finished, with no attention. The subtree with the oldest newest evidence goes first, ties to the lower identity key. Roots are never displaced. Without such a subtree the new root is refused.
- A refusal is silent to the reporter. The hook still sees its publication accepted at the edge. The core records `message.received` refused with `capacity`.
- A native assistant task (#505) will be one root of its own source under the same rule. Step 8 tests the source-agnostic rule with synthetic roots of two sources. #505 tests it with native tasks.

### 8. Duplicates and ordering

Four guarantees stay distinct:

1. Transport duplicates: `(source, id)` in `core_taken`, kept 24 hours past the later of commit and observation (`store.ts:587`, `:606-611`). An exact repeat is `duplicate`, and other content is `duplicate-conflict`.
2. Semantic duplicates and collisions: the seen content keys and collision rule (`reducer.ts:78-89`), with keys hashed from the observation's canonical content. Step 7 drops session data, so it keeps no compatibility with the 1.x key form.
3. Ordering: per-dimension watermarks and epochs (`reducer.ts:120-154`).
4. Retired turns and retirement guards: the retired-turn check and bounded retirement records (`reducer.ts:111-112`, `packages/agent-state/src/retirement.ts`).

### 9. Generations

From step 7 a new session's `generation` is the core revision of the transaction that creates it, not agent-state's revision. The core revision lives in `core_revision`, survives the reset and only grows. A guard that compares generations therefore cannot match across the reset. Such guards are in the robots, the companions, the read helpers and Nanoleaf's recreated-task check. A record's generation is never after its revision.

### 10. The shared read function and every reader

`packages/event-contracts/src/v2/session.ts` (step 1) exports:

- `readSession(message)`: validates a session state message and returns a version-independent `SessionView`, or nothing for anything it does not accept. Through step 8 it accepts `session/2.0` and `session/2.1`. In step 9 it switches to `session/3.0` in the same pull request in which the core switches.
- `statusOf(claims)`: the status function of decision 3, which the core uses too.
- `forConsumer(view, policy)`: applies a reader's acknowledgment policy (any consumer, or named consumers) and whether read evidence counts.
- `highestStatus`, `sessionState` and `STATUS_COLORS`: kept with their names and ranking, now over the view.
- `opportunityMatches(view, opportunity, consumer)`: the opportunity is still current for this session. Generation, identity and turn match, and the attention item is still present, or the notice is still present and not acknowledged by `consumer`. A reader adds only its own device conditions.

Step 1 placed everything but `readSession` in `session-view.ts`, whose only runtime import is the import-free `status.ts`, so a browser part can bundle it; `session.ts` re-exports it and adds `readSession`, which needs the validator. Group 1 is inert: `status.ts` keeps today's helper over records unchanged, and LIFX and the Tidbyt tile keep calling it. The view's `sessionState` and `highestStatus` take views only and share `status.ts`'s colors and ranking; each reader's step moves the reader onto them. `sessionView(record)` gives the view of a record its copy already validated. The case set's inertness test checks the live helper against the 1.x helper on every case and against main's results where a check pins them. The attention item matches by kind, ID and turn. A view whose status detail this version does not know (`knownDetail`) matches no opportunity.

`packages/event-contracts/fixtures/v2/session-cases.json` (step 1) is the shared synthetic case set. Each case holds an input sequence (observations, commands, clock advances and restarts), the expected records and the expected occurrence sequence. It also holds expected reader outputs: status per consumer policy, the Tronbyt row, the Pixoo row, the Nanoleaf task status, the dashboard chip, the LIFX color and opportunity matches. The core's tests and every reader's tests run it. The cases include: launch, clear and resume without a prompt; mid-turn compaction; an approval raised and resolved; a question silent for more than five minutes; working silent for more than five minutes; restart with a question, an outcome and running work; a stale delayed start; parent and child updates; a child-only working root; duplicates and collisions; out-of-order evidence; ambiguous ordering; capacity; 24-hour expiry; runtime-end retirement; per-consumer acknowledgment; an unknown detail token; and the cutover reset.

The loader is `loadSessionCases()` in `@jimmie-potts/event-contracts/v2/session-cases`. It expands the compact cases into messages the core families accept: each step's observation or command, and each check's expected copy as `session/2.0` records until step 9 rewrites them as `session/3.0`. Revisions and generations count steps, so the core compares their order. Each case names in `since` the first step whose core produces it: today's core, step 7 (the reset) or step 8 (root starts, restart marking and capacity). Each check also holds the removals and the occurrences since the previous check. The contracts suite checks the hub status, each named policy (`default`, `dashboard`, `nanoleaf`), `highestStatus` and opportunity matching with the package's functions, and the Tronbyt, Pixoo, Nanoleaf and dashboard outputs against a reference of this decision's reader rules that each reader's step replaces with its own code. Its expected records for today's behavior equal what today's reducer and projection produce. The cases include the three records of "Rule 3 pending the owner" with today's live results, a notice a known later turn superseded, lost activity evidence on running work, an unsynced copy, and the Pixoo children marker. Today's hook subagents never become idle, because a child's unknown turn makes its stop ambiguous, so the capacity case gives its child a known turn.

Every reader moves onto the function. Only the function and the core change at the switch.

| Step | Reader | Files | Accepted behavior |
| --- | --- | --- | --- |
| 3 | Tronbyt status tile | `modules/tidbyt/src/status.ts`, `module.ts:738-743` | `?` only for `unknown` status or unconfirmed work, or an unsynced copy. A waiting or finished session is never `?` from age. The attention gate for moments and ambient art is unchanged. |
| 3 | Pixoo Monitor | `modules/pixoo/src/presentation/agent-dashboard.ts`, `sources.ts`, `module/monitor-content.ts`, `module/schemas.ts`, `frontend/monitor.tsx` | Marker rule below. |
| 3 | Nanoleaf | `modules/nanoleaf/src/module/feed.ts` (boundary), `module/runtime.ts`, `shared-input.ts:310-318`, `:369-376`, `:436-461` | Follows the hub's status per task. Its own freshness rules go. Rule below. |
| 3 | LIFX | `modules/lifx/src/module.ts:749` | No behavior change. Runs the case set. |
| 4 | Companions | `modules/companions/src/presentation-policy.ts`, `rules.ts`, `module.ts`, `frontend/suggestion-model.ts`, `frontend/speech.tsx`, `assistant/tools.ts` | No session-age term. 30-second question window below. `read_sessions` reports the shared status. |
| 4 | Core opportunity admission | `apps/runtime/src/core/companion-part.ts:85-107`, `packages/event-contracts/src/v2/companions.ts:40-45` | No freshness term. The opportunity contract and its host-clock validity checks stay unchanged. |
| 4 | Reachy | `modules/reachy-mini/src/module.ts:139-145` | `opportunityMatches` plus its own device conditions. No freshness term. |
| 4 | MicroDuck | `modules/microduck/src/module.ts:154-162` | As Reachy. No blanket session-count rule. |
| 5 | Dashboard rows, card and Habitat | `apps/runtime/dashboard/src/sessions.ts`, `agent-sessions.tsx`, `agent-status-card.tsx`, `habitat/session.ts`, `habitat/controller.ts`, `habitat.tsx`, `connection.ts`, `widgets.ts` | Uncertain only for `unknown` status, unconfirmed work or an unsynced copy. The dashboard's acknowledgment and read policy is unchanged. |
| 5 | Notice override control | `apps/runtime/dashboard/src/operator-tools.tsx:26`, `:54`, `notice-clear.ts` | No freshness term. Keeps the synced copy, the selected notice and the expected-revision guard. |
| 5 | Timeline | `apps/runtime/dashboard/src/timeline-model.ts:181` | Titles a `session/3.0` change from `status`, keeps today's rule for old rows and falls back to its generic title otherwise. |
| 5 | Gateway and MCP | `apps/runtime/src/gateway/gateway.ts` (approval recovery, snapshot), `gateway/mcp.ts`, `apps/runtime/src/core/core.ts:169-189` (`core_sessions`) | Pass records unchanged. `core_sessions` takes its `provider` filter from the supported-source definition. Tool descriptions name the shared status in step 9. |
| 5 | Automations and the art alert | `apps/runtime/src/core/automation-part.ts:32-35`, `:241`, `:258`, `:263`, `:272-277` | Attention reads use `needs-owner`. Triggers stay the four live occurrences. |
| 5 | SDK frontend types | `packages/sdk/src/frontend.ts` | Exposes the view. |
| 6 | Codex Desktop module | `modules/codex-desktop/src/evidence.ts:20-38`, `module.ts:163-240` | The settle rule reads work state from the view. |
| 6 | Read-receipt helpers | `apps/runtime/src/read-receipts/helper.ts:31-36`, `codex-publisher.ts:25-30`, `qualification.ts`, run by `apps/runtime/bin/claude-read.mjs`, `codex-observer.mjs` and `codex-with-read.mjs` | Accept what `readSession` accepts. Generation, turn, notice and receipt matching is unchanged. |
| 6 | Read-receipt eligibility | `packages/event-contracts/src/v2/read-receipts.ts` (`decideReadReceipt`, used by the core store at `store.ts:300` and by the helpers) | Reads the view's work state instead of the record's `activity`, which `session/3.0` drops. |
| 9 | Verification tooling | `apps/runtime/verify/mac-codex.ts`, `follow-proof.ts`, `plugin.ts`, `speech-browser.ts` | Read the view. |

The owner's step list names readers in groups 3 to 6. This table places the unnamed ones: LIFX in step 3, the core's opportunity admission in step 4, automations, the art alert, the SDK frontend types, the gateway's routes and `core_sessions` in step 5, `decideReadReceipt` in step 6, and the verification tooling in step 9.

Reader policies:

- **Nanoleaf (decision 1 and the owner's decision of 2026-11-18T15:27Z).** Nanoleaf keeps no session rule of its own. The feed boundary (`feed.ts:25-36`) reads each session with `readSession` and applies `forConsumer` with Nanoleaf's policy: its own acknowledgment counts, and read evidence counts, as today. A task's Lines status then comes from the hub's statuses of its members. `blocked` is a member that needs the owner with detail `approval` or `input`, and `question` is one with detail `question`. `working` is a root or member whose status is `working`, `unread` is a root whose status for Nanoleaf is `finished`, and `idle` is a root that is `quiet` or `unknown`. A task whose hub status is `unknown` shows idle at once, as today's derivation does for unknown activity (`shared-input.ts:316`, `:436`), including a new task whose first status is `unknown`. Grouping subagents into their root's task, which is presentation, stays. `semanticStatus` (`shared-input.ts:310-318`) becomes this mapping.
  - The only steady hold Nanoleaf applies beyond idle's own steady slot is the hub's unconfirmed work: a `working` task with no working member whose work is confirmed. This replaces the freshness test at `shared-input.ts:436`, which goes.
  - `supporters` (`:369-376`), with its `child.freshness === 'current'` term at `:374`, goes. The hub's `working` status and its `subagent` detail already count only children with confirmed work.
  - The retention at `:445-461` keeps a previous status while evidence is stale, with clearing exceptions that read member freshness (`evidenceCleared`, `childAlert`, `ownerClearedBlock`, `unreadCleared`). It goes with its four exceptions: every hub status replaces the displayed status at once.
  - Waiting and unread tasks therefore keep their indication until the hub's status changes, whatever the silence. Working tasks with unconfirmed work hold steady, as stale ones do today (`:556`). Effects, wave epochs, source reservations, mode and connection rules, the frozen state of a lost copy, and no-replay on resync stay unchanged.
  - Step 3 amends the Nanoleaf preservation line in `AGENTS.md`: the Lines follow the hub's shared status, so waiting and unread tasks keep their indication until that status changes. Other preserved Nanoleaf behavior stays.
- **Pixoo marker.** A row is marked uncertain when the copy's connection is not current, the status is `unknown`, the status is `working` with unconfirmed work, an unavailable warning applies (`warnsForUnavailable`), or its parent is ambiguous. The age, parent-unknown and turn-unknown terms of `agent-dashboard.ts:84` go. Every hook root has an unknown parent (`providers.ts:60`), so those terms marked almost every root uncertain today. The children marker shows when the row's `unconfirmed` child count is above zero, a parent is ambiguous, or the connection is not current. The all-sessions parent-unknown term (`agent-dashboard.ts:80`) goes.
- **30-second question window (decision 2).** The core's companion part raises a coding-attention opportunity when it takes the live `attention-raised` occurrence. The window uses the host's clock, as today (owner, [2026-11-18T16:07Z](https://github.com/jimmie-potts/agent-device-hub/issues/1865#issuecomment-6984113948)): validity runs 30 seconds from the observation's own instant, the earlier of `observedAtMs` and `occurredAtMs` (`companion-part.ts:89`). The existing `companion-opportunity/2.0` contract and its checks (`packages/event-contracts/src/v2/companions.ts:40-45`) stay unchanged. Known limit: the core drops the question's companion opportunity when the reporting host's clock runs ahead of the hub's, and when it runs 30 seconds or more behind; a host clock behind by less shortens the window (`companion-part.ts:90`). That question then gets no priority window, card or speech. Status devices are unaffected, because they read the session's status, not the opportunity. A hub receipt-time stamp on the opportunity would remove the limit; it is a possible later fix and out of scope here. The companions module and the browser's final speech and suggestion checks give `attention-priority` only while an admitted coding-attention opportunity is valid and its attention item is still present. The window lives in memory, a design choice taken from the coordinator's plan, so a restart starts no new window and replays nothing. The question stays visible afterward. Unrelated progress raises no new opportunity, so it does not renew priority. Explicitly requested assistant answers stay separate. The Tidbyt and Pixoo gates that hold moments and ambient art while any attention exists are not background cards in this sense, and they are unchanged.
- **Robots and cards (decision 3).** Admission keeps the opportunity's validity window, `opportunityMatches`, mode, Quiet, takeover, interruption, spacing and queues. The freshness and restart terms go, as does MicroDuck's "exactly one fresh session" rule. Work uncertainty alone does not abandon an approval.
- **Coding suggestions.** The session-age term (`presentation-policy.ts:11`, `suggestion-model.ts:32`) goes. Each suggestion's own evidence window, exact session, revision, generation and turn match, and the 30-second attention priority remain.
- **Approval recovery.** Allowed only while the session's work claim is unconfirmed, for its deadline or a restart. This replaces "five minutes without evidence or since a restart" (`index.ts:369`).

### 11. History

Old `session/2.x` history rows stay as they are, and readers skip or generically title rows in a shape they do not know. Step 7 (the owner plan's step 8) deletes the session family's rows from `core_history_latest` and `core_history_span` in its reset transaction, so the first new row of each session is a change with `previous: null`. Only that step clears the pointer, as the owner decided. At the switch to `session/3.0` (step 9) the first 3.0 row of a session is diffed against its last 2.x row. Nothing is lost, because a change row lists each changed member and each removed member (`apps/runtime/src/core/history.ts:452-459`), and the timeline reads both shapes from step 5. History fact rows are never updated or deleted. #1774's growth measurement will show one jump at step 7. The history owners hear of this through the owner.

### 12. Storage, the one-time reset and writer exclusion

Step 7 moves session state into core tables and removes agent-state's storage contract from the core:

- New tables in the core store: one row per stored session (entity ID, revision, generation, stored session JSON) and one per retirement guard. The consumer list becomes a code constant (`DEFAULT_CONSUMERS`, `core.ts:60`), so agent-state's stored consumer check goes. The agent-state journal goes, because history replaces it.
- `CoreStore` stops implementing `Storage`. `acquire`, the lease object, `apply`, `#load`, `#commitChange`, `#checkOwner` and `#matches` go. `CoreStore.open()` runs inside the core's start, before the core serves a sync or republishes. It borrows the runtime's ownership, or takes the lock when no ownership was passed, as tests and offline harnesses do. It then creates the tables, runs the reset when it applies and loads caches. This is the core's ordinary start, not a separate step. A store that cannot open leaves the core running and refusing durable work, as today's reopen path does (`core.ts:585-597`).
- Writer exclusion rests on the two existing layers: the runtime lease taken before the core (`runtime-ownership.ts:44`) and SQLite exclusive locking (`database.ts:46`). The removed `ownerId` check only guarded the old `state` row against another agent-state owner. Step 7 keeps a test that a second runtime on the same state directory is refused, and one that an offline tool holding the lease stops a runtime from starting.
- The one-time reset runs in the first open that finds the old `state` table. In one transaction it drops the `state` table, empties the new session and retirement-guard tables, and deletes the session family's `core_records` rows. It deletes the session family's latest-history and span rows (decision 11). It deletes pending outbox rows whose routing keys are session states, session removals or agent occurrences (`bunny.state.session.*`, `bunny.event.attention-raised.*`, `bunny.event.attention-cleared.*`, `bunny.event.turn-ended.*`, `bunny.event.session-ended.*`). It raises the core revision by one and publishes nothing: no removal, no occurrence and no history row. The next sync therefore serves the empty session family at a revision no earlier payload carried. Its key is the old data's presence, so it needs no marker. Once the table is gone a later start finds nothing to drop. Any run leaves one consistent empty session state. Other parts' tables, history rows, the outbox's other rows and `core_taken` stay, and `core_revision` only grows.
- Consumers lose no truth. The runtime restarts for the upgrade, so every in-process module syncs again, and remote consumers resync when their stream restarts. A sync replaces the full membership, so no copy keeps a dropped session. Each live session returns at its next observation, as a new record with a new generation.

Failure and recovery:

| Fault | Behavior | Recovery |
| --- | --- | --- |
| Crash or power loss during the reset | One SQLite transaction: either nothing changed or all of it did | The next start runs the reset again or finds nothing to drop |
| Full disk at the reset | The open fails before anything is reported, whether at creating the tables or in the reset's own transaction, and the store exposes nothing until an open succeeds whole: no pending message goes out, no part commits and `core_revision` stays as stored. The core runs and refuses intake with `capacity` and syncs with `unavailable` | The capped backoff opens it again (1 s doubling to 60 s), and the reset runs then |
| Second runtime on the same state directory | Refused at runtime ownership, before the core opens | None needed. The first keeps running |
| Release before step 7 run on a reset store | Starts with empty session state and writes a new `state` row. Session rows from step 7 stay unread | Forward again. The next step-7 start finds the `state` row and resets everything, the step's own session and guard tables included. Rolling back below step 7 is unsupported for session data |
| Pending session publications at upgrade | Deleted by the reset, so they never go out | Consumers resync. Occurrences are not replayed |
| Automations | No occurrence comes from the reset or the restart marking, and republication is never eligible (`automation-part.ts:270-277`) | None needed |

Recovery is fix-forward with no snapshot restore. Downtime and loss of session-monitoring data are accepted (owner, 2026-11-18). The reset clears session monitoring only. It is not a command to clear other core data. Step 7 adds a section to `apps/runtime/UPGRADE.md`, beside "Core history fact log", that names the one transaction, what it drops, its failure behavior and that rollback below step 7 is unsupported for session data.

Step 7 settled the storage mechanics as follows:

- The tables are `core_sessions` (entity ID, the core revision of the row's last write, generation and the stored session as JSON, read back in the order sessions were first stored) and `core_session_guards` (one guard per row, in order). Published records stay in `core_records`, which sync and the restart read.
- `CoreStore.open(signal)` waits for a lease another holder has until `signal` aborts. The core passes three seconds, agent-state's former deadline, so an offline tool's lease still fails the core's start after that wait, and the runtime exits with `core-failed`.
- The reset records `operation.completed` with `bunny.operation` `storage` and no other attribute. The existing catalog expresses it, so no event or attribute is added.
- A notice on an unknown turn is named from the observation's semantic key, so its ID is not the 1.x one. The differential test normalizes notice IDs with revisions and generations, and the core's run of the case set compares such notices by turn. The case set's literal IDs for those notices name the 1.x IDs until step 9 rewrites the case set.
- The session logic bounds an observation at 2,304 bytes of its own compact JSON: 1.x's 2,048-byte event bound, with room for the ordering authority that 2.0 adds.
- Restart uncertainty stays in memory, as in agent-state's owner; step 8 stores the restart marking. The floor that keeps a change's instant from going back before an earlier change's is held in memory too. agent-state kept it durably as `lastCommitAtMs`; the core rebuilds it at open from the stored sessions' `lastEvidenceAtMs` and the guards' `atMs`, so after a restart on a clock that went back it can sit below the instant of a last commit that was a command. Only evidence instants across such a step can differ.

### 13. Host-installed code and install skew

Hooks and read-receipt helpers run from each host's installed release, not the runtime image.

- **Hooks.** The `lifecycle/2.0` wire does not change in any step. Step 2 proves byte-identical output. An older host's hook keeps reporting, and the #397 correction applies to it in the core. Producer files are read unchanged, including `lifecycleVersion`, which selects title enrichment (`hook.ts:76`, `:82-83`). Changing those files would be a personal-settings change.
- **Read-receipt helpers.** Through step 8 the core publishes `session/2.x`, which every helper accepts. After step 9 an older helper finds no record it accepts (`helper.ts:31-36`). Its receipts stop quietly, with no wrong receipt and no session change, until the host gets a release with step 9 (owner, 2026-11-18). #1869 updates each such host in the batch that carries step 9, or records it as degraded with its owner and next action.
- **Shared main.** Every step's revision is installable. Step 7 drops session data on its first start, and step 9 stops older host read helpers. The coordinator gives the deployment owner those two facts with the merged revisions. No deployment hold is needed, because no intermediate revision is unsafe to install.

### 14. Titles

Step 2 moves the normalizer and title reader with identical output, proven by golden tests that run the retained package's path beside the new one. The core's title operation ports unchanged in step 7. Display precedence stays label, then title, then the reader's neutral fallback. #1847's PC check stays valid, and whichever of the two merges second adapts to the other (owner, 2026-11-18). The PC's installed release is not updated while #1847's check runs.

## Owner decisions and where they land

Step numbers in this design follow `tasks.md`. Step 7 here is the owner plan's steps 7 and 8 merged (coordinator decision on review, 2026-11-18). Step 8 here is the plan's step 9, and step 9 is the plan's step 10.

| Decision | Where |
| --- | --- |
| 2026-11-16 (1): waiting Nanoleaf Lines keep their indication, and the preservation line is amended | Decision 10, step 3 |
| 2026-11-16 (2): 30-second question priority from its own evidence time | Decision 10, step 4 (see below) |
| 2026-11-16 (3): no blanket MicroDuck session-count rule | Decision 10, step 4 |
| 2026-11-16 (4): restart makes running work unconfirmed, and questions and outcomes stay | Decision 4, step 8 |
| 2026-11-16 (5): flatten, one transition and commit path, empty once at cutover | Decisions 1, 5 and 12, steps 2 and 7 |
| 2026-11-16 (6): #1866 folded in, progress to #1867, workers deferred from #505 | Scope of this change |
| 2026-11-18: downtime and data loss accepted, fix forward | Decision 12 |
| 2026-11-18: no separate store start-up step | Decision 12: the store opens inside the core's start |
| 2026-11-18: nothing built beside the live path | Every step changes the live path in place |
| 2026-11-18: old session data dropped on start, no reset marker, no compatibility record | Decisions 12 and 13 |
| 2026-11-18: restart marks running work unconfirmed, no stored run epoch | Decision 4 |
| 2026-11-18: older hosts' read receipts stop until updated | Decision 13 |
| 2026-11-18: old history rows stay, and the latest pointer is cleared once at the storage step | Decision 11 |
| 2026-11-18: title output identical, #1847 not waited for | Decision 14 |
| [2026-11-18T15:27Z](https://github.com/jimmie-potts/agent-device-hub/issues/1865#issuecomment-6983037889): Nanoleaf follows the hub's shared status, with no session rule of its own | Decision 10, step 3 |

Holding the 30-second window in memory comes from the coordinator's plan, not from an owner decision. This design adopts it as a design choice (decision 10).

The owner's plan lands decision 2 in step 3. Its code is in the companions module, the core's companion part and the opportunity contract, which belong to step 4's reader group. No step 3 reader has a freshness-based priority rule. This design therefore lands decision 2 in step 4 and leaves the step 3 attention gates unchanged. The coordinator confirmed this placement on #1865 before step 3 or 4 started.

## Requirements from the pre-implementation review

| Requirement | Answer |
| --- | --- |
| Writer exclusion | Decision 12. The lock is borrowed and the tables and caches load in `CoreStore.open()` at the core's start. The owner check goes with the old row. Tests cover a refused second runtime and an offline tool. |
| Host-installed code | Decision 13. Hooks stay wire-compatible, and helpers stop after step 9 until each host is updated (#1869). |
| Shared main | Decision 13. Every revision is installable. The reset rides in step 7 and runs once, keyed on the old data's presence (owner decision: no stored marker). |
| Automations | Decisions 5 and 12. Occurrence payloads and order are unchanged. Reset and restart marking emit none. Occurrence sequences are in the case set. Focused second reviews are listed below. |
| Nanoleaf and Pixoo | Decision 10. |
| Session limit | Decision 7. |
| Clock | Decisions 4 and 10. Work deadlines use the core's receipt clock. The question window uses the host's clock, as today, with the known limit decision 10 states. |
| History | Decision 11. |
| Reset | Decision 12. A step 7 test opens a synthetic store shaped like an installed one, with an old `state` row, old session records, session latest-history rows and pending session outbox rows. |
| Review | Below and in `tasks.md`. |

## Component boundaries (ADR 0012)

Each entry names the rule it follows. No exception to ADR 0012 or the diagnostic contract is needed.

**Entry points and hand-offs.**

- Hook to edge to core: `bunny.event.lifecycle.<session>` through `publishOnce` and the core's subscription (`core.ts:489`). ADR 0012 "Ownership and publication": hooks stay bounded and fail-open.
- In-process producers: the Codex Desktop module's read and metadata observations on the same subscription (`core.ts:698-770`), and later #505's native outbox.
- Read-receipt helpers: SDK edge sync of `session`, then `lifecycle/2.1` receipts to the core's serialized intake (`store.ts:298-323`).
- Operator commands: `notice-acknowledge`, `notice-clear`, `approval-recover` and `session-label-set`, through the gateway, MCP and the SDK edge.
- Core to readers: `session` state, removal and occurrence messages after each commit, plus sync. Core to companions: `companion-opportunity` from the live occurrence. Core to automations: the four live occurrences, as `committed` hands them over (`automation-part.ts:272-277`).

**Refusals and outcomes.** Observations are occurrences, so they have no reply or outcome. The core records `accepted`, `duplicate`, `stale` or a typed refusal. Operator commands keep their replies: `accepted` after the commit, or a typed refusal with no effect. Labels and notice overrides keep their tracked completion. ADR 0012 "Errors, effects and outcomes": a rejection proves no effect, and committed is not published. No command has an `uncertain` or `expired` path that changes here.

**Codes and retry policy.** Existing registry codes only: `invalid-message`, `invalid-request`, `duplicate-conflict`, `forbidden`, `capacity`, `unavailable`, `not-found`, `revision-conflict`, `invalid-state` and `internal`. No new code. Hooks never retry. The Codex Desktop module keeps its own capped re-send of read evidence, an observation it owns. The outbox republishes committed messages. No command is ever resent. ADR 0012 "Retries".

**Diagnostic records and trace continuity.** The core records `message.received` once per intake with its outcome, `command.completed` or `command.rejected` per command, and the storage transitions and summaries it records today (ADR 0012 "Records at decision points" and "Repetition"). Levels come from `levelOf`. A hook's message starts the trace, and the commit's messages carry it as parent (`store.ts:598`). Deadline publications, restart marking and the reset have no cause and start new roots or stay untraced, never with a fabricated parent (diagnostic contract, "Traces and context"). The reset records one existing `operation.completed` record with `bunny.operation` `storage` and no new event or attribute. If the catalog cannot express it without an addition, the step records nothing new and says so. `storage.cost.*` keeps measuring save time. Its size condition (#976) retires with the state block: with one row per session and at most 128 sessions, no save can approach the old limit, so step 7 removes the condition and its `bunny.state.bytes` record rather than keep a check that cannot fire. Step 7 updates "Core save cost" to match. No session content enters logs.

**Fault cases.** Malformed or cross-source observations are refused at the edge or intake. A reused `(source, id)` is a conflict. The store can be full, fail or crash between commit and publish. The core can be full at the session limit. Older host hooks and read helpers are covered by decision 13. Delayed or reordered events after a restart, host clock skew, a lost consumer stream (resync, no replay), a second runtime and a crash during the reset are covered above. Each is in the case set or the store tests.

## Delivery steps and cut lines

`tasks.md` holds each step's work and evidence. The design first checked the owner plan's cut lines for its steps 7 to 9 against the code. Its step 7 could stand alone only by keeping agent-state's storage contract: the ported logic would still lease `CoreStore.acquire` and commit the 2.1 state row (`store.ts:357`, `:510`), with 1.x-compatible semantic keys. That is compatibility code its step 8 would delete at once. On review the coordinator merged the two (2026-11-18), as the owner's plan allows. The plan now has nine steps:

- **Step 7 (plan steps 7 and 8).** Observations go straight into the ported session logic, sessions move into core tables, and the `state` row, the lease adapter and the owner check go. The transition result replaces `#plan` and `#matches` (`store.ts:687`, `:780`), generations come from the core revision, and the reset runs. A differential test feeds the same observation sequences to the retained agent-state path (`toEnvelope` and `createAgentState`) and to the new one, and compares every published record and occurrence with revisions and generations normalized, because the retained path can advance revisions on commits that publish nothing (`store.ts:728`) and generations now come from the core revision. The test keeps its own copy of `toEnvelope` for the retained path. The step drops session data, so it needs no stored-format compatibility.
- **Step 8 (plan step 9).** Restart marking, the root-start handler and the capacity statement. It needs step 7's stored per-claim confidence.
- **Step 9 (plan step 10).** The switch to `session/3.0`, cleanup and the archive.

Focused second reviews, by the AGENTS.md criterion each step meets:

| Step | Criterion | What the second reviewer checks |
| --- | --- | --- |
| 4 | Device-command safety | Robot gesture and companion speech eligibility |
| 7 | Storage migration, writer exclusion and device-command safety | Session tables and the reset, the open at start and refusal of a second runtime, and the occurrences and generation guards that automations and robots depend on |
| 8 | Storage migration and device-command safety | The start transaction that writes restart marking and must start no automation, and the capacity rule's displacement |

Step 9 gets no focused second review. It changes no writer exclusion, emits no new occurrence and runs no storage migration, and the restart and storage behavior it relies on is reviewed in steps 7 and 8.

## Risks and trade-offs

- The ported rules are about 300 lines whose ordering and ambiguity handling grew over several fixes. The protection is the ported agent-state tests, translated from envelopes to observations, plus step 7's differential test.
- Step 7 is the largest pull request: the logic port and the storage change land together.
- Readers move before the format. Between steps 3 and 9 the shared function reads `session/2.x`, whose freshness still ages waiting sessions. The function maps it so that only work becomes unconfirmed. Readers show the new meaning from step 3 on.
- Publishing only on meaning change makes the public evidence time lag private progress. Readers that order by it, or show it, see the time of the last published change.
- A future minor version, such as #505's native source, stops older host read helpers until they are updated, as today. A minor-tolerant reader is a separate decision and is not taken here.

## Open questions

None. Decision 2's placement in step 4 with the companions was confirmed by the coordinator on #1865 (comment 6984552157, 2026-11-18).

## Validation

Each step uses Node 24 from the worktree root and runs the checks its area guide names. All steps run `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run check:workflow` and `npm run test:workflow`, plus `npm run ci:select` with the delivery comparison. Contract steps add `npm run test:events:built`, `npm run test:events:python` and the packaged contract checks. Core steps add `npm run test:runtime:built`, `npm run test:runtime:scenarios:built` and the SDK suite. Reader steps add each module's suite: `test:tidbyt-module:built`, `test:pixoo:built`, `test:nanoleaf:built`, `test:lifx-module:built`, `test:companions:built`, `test:reachy:built`, `test:microduck:built`, `test:runtime-dashboard:built` and `test:codex-desktop:built`, with their browser suites where a page changes. Tests use the injected clock and scheduler, with no real-clock waits. Behavior that a person can observe gets a disposable acceptance exercise with synthetic sessions. Installed, client and physical acceptance stay with #1869.
