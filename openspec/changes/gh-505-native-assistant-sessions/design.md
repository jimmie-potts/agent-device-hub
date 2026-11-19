## Context

Source references are to main `5a3a72c5`. The implementing pull request rechecks them, and rebases this design onto #1947's amended `session/3.0` if #1947 merges first.

The companions engine owns assistant tasks (`modules/companions/src/assistant/engine.ts`). A task has a stable ID, its profile's conversation ID, a status (`running`, `waiting`, `paused`, `succeeded`, `failed`, `cancelled` or `uncertain`), the current run ID and at most one saved question (`store.ts:16-20`). Each explicit activation creates a new run (`engine.ts:162-172`). A question is a clarification, an approval or a delegation (`history-contract.ts`). Every task change commits through the module's SDK outbox together with its `assistant-state` publication (`engine.ts:137-142`, `:173-189`, `:600-612`). One task is unfinished at a time across the three profiles (`engine.ts:254`).

The core takes `lifecycle` observations on `bunny.event.lifecycle.*` (`apps/runtime/src/core/core.ts:494`, `:687-768`), reduces them with the ported reducer (`core/session/reducer.ts`) inside one transition (`core/session/transition.ts`) and publishes `session/3.0` records and the four agent occurrences (`core/store.ts:457-490`, `:837-847`). Providers and clients come from the supported-source definition (`packages/event-contracts/src/v2/sources.ts`). `session/3.0`'s identity enum names Codex and Claude only; the lifecycle schemas and the occurrence schemas refer to `session/2.0`'s identity (`lifecycle.schema.json:9`, `attention-raised.schema.json:6`). Status rule 3 always gives `finished` with detail `turn-ended` (`session-view.ts:61`), and `session/3.0` notices have no result (`session.3.0.schema.json`, `notice`).

No producer sends known ordering today (#1865 design decision 5). With unknown ordering the reducer treats any change of work state other than a start or a matching stop as a conflict and makes activity ambiguous (`reducer.ts:294-303`).

## Goals and non-goals

Goals:

- Each assistant task is one monitoring session whose status, work, attention and outcome claims say what the task's committed state says, and nothing more.
- Observations commit with the task change and travel the existing outbox, bus and core intake. Duplicate or late delivery cannot revive ended work, resolve another question or repeat an effect.
- The new source and inputs are reviewed contract versions. Current readers adopt them in the same change.

Non-goals:

- No native worker reporting, worker adapter or dispatch, and no child sessions. The relationship claim stays as it is.
- No new transport, queue, retry policy, polling path, event sourcing or provider framework. No device reply input, transcript or output broadcast, and no model spending.
- No change to hooks, producer files or read-receipt helpers, and no installed change.

## Decisions

### 1. The native source and identity

`sources.ts` gains one entry: provider `bunny` with client `assistant`, no hooks, and its producer source `bunny/modules/companions`. An empty hook list keeps the hook adapter from accepting the provider (`apps/runtime/src/hook/adapter.ts:63`). The producer field is the one fact the core's binding reads (decision 6). It is not a provider framework: only this entry has it.

A task's identity is `{provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', sessionId: <task ID>}`. `hostId` names the brain rather than a machine, so the identity survives a move of the brain. `sourceId` is the ordering authority (decision 5). The session's `parent` is `top-level`. Its `title` is the profile's persona name (`B.U.N.N.Y.`, `Reachy`, `MicroDuck`) with source `provider`. No prompt, answer or other conversation text enters the record (#425 owns content capture).

### 2. Contract versions, and the version each record uses

| Family | New version | What it adds |
| --- | --- | --- |
| `session` | `3.1` | `3.0` with the identity widened to the native source and an optional notice `result` (`succeeded`, `failed` or `cancelled`) |
| `lifecycle` | `2.2` | `2.0` with the widened identity, the inputs `turn-waiting` and `turn-uncertain`, and an optional `result` on `turn-ended` |
| `attention-raised`, `attention-cleared`, `turn-ended` | `2.1` | `2.0` with the widened identity |

`session/3.1` defines its own identity, so its schema follows the source definition, and the 2.1 occurrences and `lifecycle/2.2` refer to it. `tests/sources.test.mjs` adds the new identities to its list. `session-ended`, `companion-opportunity`, `desktop-metadata`, `volcano-observation`, `lifecycle/2.0` and `lifecycle/2.1` do not change: no native session ends by a runtime end (decision 3), and the companion part raises no opportunity for the native source (open question 4).

The core publishes each record and occurrence in the lowest version that expresses it, as it published `session/2.0` and `2.1` before #1865 step 9 (`packages/event-contracts/README.md`, "Explicit client read receipts"). A Codex or Claude record therefore stays `session/3.0`, and its occurrences stay 2.0. A native record is `session/3.1`, and its occurrences are 2.1. The hook adapter keeps publishing `lifecycle/2.0`, byte for byte. The core accepts `lifecycle/2.0`, `2.1` and `2.2`.

`readSession` reads `session/3.0` and `3.1`. The view type becomes the `session/3.1` record, of which a `3.0` record is a subset. Every current reader adopts both through the shared read function in this change. No reader keeps a version rule of its own.

### 3. Input mapping

The engine's task changes map to observations. Each row lists the observations the transaction that commits the change adds, in order.

| Task change | Observations | Session after it |
| --- | --- | --- |
| A start or resume admitted (new run R) | `turn-started` on R | turn R, work `active` |
| An owner answer admitted (question Q of run R, new run R2) | `attention-resolved` Q on R, then `turn-started` on R2 | Q cleared, turn R2, work `active` |
| A clarification saved in run R | `attention-input` Q on R | attention item `input` Q |
| An approval proposal saved in run R | `attention-approval` Q on R | attention item `approval` Q |
| A delegation hand-off accepted | none (see open question 2) | unchanged |
| The run stops at a question or delegation (`waiting`) | `turn-waiting` on R | work `idle`, no notice |
| The run is cut off and the task is resumable (`paused`) | `turn-interrupted` on R | work `interrupted` |
| A call's fate is unknown (`uncertain`) | `turn-uncertain` on R | work `unknown`, activity `lost` |
| The task succeeds, fails or is cancelled | `turn-ended` on R with `result` | work `idle`, one notice with the result, no attention |

Notes:

- A conversation opening, an enable or disable, a page read, a history read and a spoken reply are not work and add nothing. Startup reconciliation and outbox republication add only what a committed state change adds (decision 7).
- A clarification is `input`, not `question`: it blocks the task until the owner answers (`docs/provider-qualification.md`, "Explicit blocking-input operation"). An approval is `approval`. A delegation wait is not owner attention.
- The answer resolves only its own question: the observation names the question ID and the turn it was raised on. A worker's word for a delegation resolves nothing, because a delegation raised no item.
- A paused task makes no running-work claim: its work is `interrupted`, so its status is `quiet`. This covers a run stopped by shutdown, by a restart's recovery and by the active-time limit. The engine has no owner interrupt; an owner's stop is `cancelled`.
- `turn-waiting` and `turn-uncertain` are common inputs: any later source may send them. Today only the native producer may (decision 6).

### 4. State and status

| Task status | Work | Attention | Outcome | Hub status (class/detail) |
| --- | --- | --- | --- | --- |
| `running` | `active`, confirmed | none | none | `working`/`confirmed` |
| `waiting` on a clarification or approval | `idle` | one item | none | `needs-owner`/`input` or `approval` |
| `waiting` on a delegation | `idle` | none | none | `quiet`/`idle` (open question 2) |
| `paused`, question still open | `interrupted` | one item | none | `needs-owner`/`input` or `approval` |
| `paused` | `interrupted` | none | none | `quiet`/`interrupted` |
| `uncertain` | `unknown` | none | none | `unknown`/`lost` |
| `succeeded` | `idle` | none | notice, `result: succeeded` | `finished`/`succeeded` |
| `failed` | `idle` | none | notice, `result: failed` | `finished`/`failed` |
| `cancelled` | `idle` | none | notice, `result: cancelled` | `finished`/`cancelled` (open question 1) |

Status rule 3 becomes: a notice that still counts gives `finished`, detailed by the result of the last such notice that has one, or `turn-ended` when none does. Codex and Claude notices carry no result, so their status is unchanged. `STATUS_DETAILS.finished` adds `succeeded`, `failed` and `cancelled`. A reader that does not know a detail falls back to `finished`, which never means success. The agent-status helper maps `finished` to `done` as today; open question 1 asks whether that stays so for `failed` and `cancelled`.

A `turn-ended` with a result clears every attention item of its turn, with cause `turn-ended`, because an ended task waits for no one. A question cancelled before its answer is therefore cleared as ended, not as resolved. Today's reducer clears only approvals without an ID at a turn end (`reducer.ts:249-256`); `turn-ended` without a result keeps that rule. An `uncertain` task is not terminal: it can be cancelled, and once late evidence settles its call it can be resumed (`engine.ts:166`, `:663-682`).

### 5. The producer

`AssistantEngine.#publish` (`engine.ts:137`) runs inside every transaction that changes a task. It gains one step: for each latest task per profile (`store.latest()`, at most three), compute the task's projection, compare it with the projection last reported for that task, and add the observations of decision 3 for the difference. The projection is `{run, work, question, result}`, a pure function of the saved task. The last reported projection and the task's ordering sequence are kept in a new module table, `assistant_reports` (task ID, sequence, projection), written in the same transaction. Only the latest task of a profile can change, so the bound holds.

Each observation carries:

- `ordering`: known, authority `companions`, epoch the task ID, sequence the task's next sequence. Every native observation already changes the session's public meaning, so publishing the ordering cursor as meaning costs nothing (#1865 design decision 5 asked #505 to decide).
- `nativeEventId`: `<sequence>`, so its semantic key is unique per observation.
- `observedAtMs`: the module clock at the change, which is the core's clock (one process).
- the trace parent of the transaction's change: the command or the run's span.

The message goes out through the existing outbox after the commit and is republished after a crash with the same `(source, id)`. Nothing else sends it. The outbox validates every message it stores and rolls back a transaction whose message it refuses (`packages/sdk/src/outbox.ts:45`), so a malformed observation would refuse the task change itself. The projection uses only bounded identifiers, and the tests build every row of decision 3, so this is a code defect, not a runtime condition.

At the first start of this release, the table is created with a baseline row for every saved task: its current projection, sequence zero, and no observation. Saved tasks therefore report only their next change. A task that was running when the runtime stopped reports `turn-interrupted` or `turn-uncertain` when startup recovers it. No state-preservation step runs in the core.

### 6. Source and identity binding

The core refuses with `forbidden`, recorded as `message.received`:

- an observation whose identity names the native provider unless its message source is the definition's producer source, its `hostId` is `core` and its `sourceId` is `companions`;
- an observation from the native producer that names any other provider;
- a `lifecycle/2.2` observation from any source other than the native producer. Hooks keep `lifecycle/2.0`.

The gateway's producer admission (`apps/runtime/src/gateway/producer-admission.ts`) also refuses a native identity from every edge credential before the bus, so a remote caller gets an error reply instead of silence. The in-process producer reaches the core on the bus without an edge, as the Codex Desktop module does.

### 7. Duplicates, delay, restart and sync

- Transport duplicates are refused by `(source, id)` (`core_taken`). A semantic duplicate is caught by the `nativeEventId` key.
- Known ordering gives each dimension a watermark: `activity` for the work events and `attention:<question>` for each question. A delayed `turn-started` for an ended run, or a delayed raise after its resolution, is `stale`. Retired turns stay a fourth guard.
- Today's ordered branch of the reducer keeps a previous turn's activity and turn unavailability when a newer turn starts. No producer exercised that branch before. This change makes an ordered, newer `turn-started` recover them as a best-effort start already does (`reducer.ts:202`), so a resumed task that was `uncertain` reads as working, not as unknown. Codex and Claude send unknown ordering and are unaffected.
- A core restart marks active native work unconfirmed (`restart`), as for every source. The engine's own startup recovers a running task as paused or uncertain and reports that change. A waiting task is reconciled to the same state and reports nothing. No activation, speech, dispatch or model call follows from either.
- A sync serves the stored records. Reads, rendering and history add nothing.
- The core refusing an observation changes nothing in the module: observations have no reply. A reporting failure never reruns a model call, a tool call or a device command, and changes no task permission.

### 8. Expiry and reappearance

A native session expires 24 hours after its last lifecycle evidence, as every session does. Expiry removes the monitoring record only. The task, its question and its history stay in the companions store, and the Conversation page still shows them. A task waiting more than a day therefore no longer shows on the devices.

The task's next change reports again. Expiry leaves no retirement guard (`transition.ts:394-404`), so the next observation creates a new session with a new generation, the same entity ID and fresh watermarks. Its claims start from that observation: an answer's `attention-resolved` and `turn-started` give a working session, and a cancel's `turn-ended` gives a finished one.

### 9. The session limit

Each assistant task counts as one root session of the native source, under the shared rule (`transition.ts:273-292`): 128 sessions from every source together, children included. At the limit a new native root may displace one finished child subtree without attention; without one it is refused with `capacity`, silently to the producer. A native root is never displaced. The module's task change is committed either way. A refused task appears at its next change once there is room, from that observation (decision 8). With one unfinished task at a time, native tasks hold at most one unfinished root and the finished roots of the last day.

### 10. Readers

Every reader uses `readSession`, so the version change reaches them together. The readers that name providers change too:

| Reader | Change |
| --- | --- |
| Shared read function and case set (`session.ts`, `session-view.ts`, `fixtures/v2/session-cases.json`) | Read `3.1`; rule 3 detail; native cases for every row of decisions 3 and 4, duplicates, delay, restart, expiry, reappearance and capacity |
| Dashboard and Habitat (`apps/runtime/dashboard/src/sessions.ts`) | Client name `B.U.N.N.Y. assistant`; the provider group from `PROVIDERS`; chip text for the finished details (open question 1) |
| Tronbyt tile (`modules/tidbyt/src/status.ts:55`) | Fallback prefix `B` for the native provider |
| Nanoleaf (`modules/nanoleaf/src/shared-input.ts:161-168`) | Accept the native source in `qualifiedSources`. Lines show native tasks only once the owner adds the source to the private configuration (#1869) |
| Companion part (`apps/runtime/src/core/companion-part.ts:103`) | Raise no opportunity for the native source (open question 4) |
| Companions `read_sessions` and coding suggestions (`modules/companions/src/assistant/tools.ts`, `frontend/suggestions.tsx`) | Leave out native sessions (open question 5) |
| `core_sessions` provider filter, Pixoo rows, LIFX and automations | No code change: they read the definition or the shared status. Pixoo's command filter enum stays Codex and Claude, so it cannot select native rows alone |

Automations take the native occurrences as they take every agent's: a rule on `attention-raised` fires for an assistant question.

### 11. A read helper from the previous release

The helpers run from each host's installed release and accept only what its `readSession` accepts (`apps/runtime/src/read-receipts/session.ts`). The SDK client stores synced messages without validating them. A previous-release helper therefore skips a native `session/3.1` record and serves the Codex and Claude `session/3.0` records exactly as before. A native record never matches a helper's own entity in any case. The disposable acceptance exercise runs the previous release's Claude read helper against this change's runtime with a native task present and checks that bind and read still confirm.

If every record moved to `3.1` instead, every previous-release helper would stop sending receipts until its host is updated, as #1865 step 9 did. The coordinator chose the per-record versions (open question 6).

### 12. Component boundaries (ADR 0012)

- Hand-off: engine transition, the existing committed outbox, the core's admission and transition, the shared session copies. No new transport, queue, retry or polling.
- Observations are occurrences: no reply and no outcome. The core records `message.received` with `accepted`, `duplicate`, `stale` or a refusal code from the registry (`forbidden`, `invalid-message`, `capacity`, `unavailable`). No new code, event or attribute.
- Trace: each observation is a child of its change's context. The core's records join that trace.
- Diagnostics: no new record. No content enters a record or log.

### 13. Deferred: native workers

The relationship claim, child counting and `relationships.children` stay as they are. When worker reporting is selected, it must establish parent and run attribution, keep the worker's hooks and its owner from both reporting the same work, keep a child's completion from implying the task's success, and keep a delegation wait from counting as attention. This change adds no worker adapter, dispatch or child session.

## Open questions

Questions 1 to 5 are product questions for the owner, each with a recommendation; the accepted decisions on #505 and #1855 do not answer them. Question 6 is decided.

1. **Terminal outcomes on devices.** A failed or cancelled task is `finished` with its result as detail. Devices that show only the class show it as done (green) until acknowledged, as they show any finished Codex or Claude turn. Options: (a) all three results are `finished`; detail-aware surfaces (dashboard, Habitat, Conversation) name the result; (b) as (a), but a task the owner cancelled leaves no unread notice (`quiet`, as a Codex interrupt does); (c) as (b), and a failed task also leaves none. Recommendation: (b). A failure is something the owner should look at; the owner's own cancel is not.
2. **Delegation wait.** While the coding worker runs a delegated task, the task's own run has ended and the worker reports through its own path. Options: (a) `quiet`/`idle`; (b) keep the run's work `active`, so devices show working until the worker's word resumes the task; after a restart it reads as unconfirmed. Recommendation: (a) for this slice: the task itself makes no running-work claim, and worker reporting, which would show the worker's work truthfully, is deferred.
3. **Demo profiles.** Options: report tasks of all three profiles, or only the `bunny` profile. Recommendation: all three, titled by persona: their questions need the owner too, and the Conversation rail already marks them.
4. **Companion opportunities.** The companion part turns every `attention-raised` and `turn-ended` into a Reachy coding opportunity with a 30-second priority window. Options: (a) none for the native source; (b) include it, which also needs `companion-opportunity/2.1` and Reachy and MicroDuck adoption. Recommendation: (a). Conversation already speaks its own question and result, so a Reachy card would repeat it.
5. **The assistant's own reads.** Options: `read_sessions` and coding suggestions list native sessions, or leave them out. Recommendation: leave them out. Both are about coding agent sessions, and listing the task that is asking would describe itself.
6. **Version per record** (engineering). Decided by the coordinator on 2026-11-19: native records are `session/3.1` and Codex and Claude records stay `session/3.0` (decision 2). Previous-release read helpers keep working, and no installed host update is needed for receipts.

## Integration with #1947

#1947 edits `session/3.0` in place (the work claim's `deadline` reason), the status builder, the core's session model, record builder, transition and store, and the case set. This change copies `session/3.0` into `3.1` and edits the same TypeScript files. Order (coordinator, 2026-11-19): #1947 merges first. This change then starts from the main that contains it, copies the amended `3.0` into `3.1`, and rebases its specification deltas onto #1947's text. #1947 removes the work deadline and the `deadline` work reason, renames the transition result's `deadlineMs` to `dueMs`, and publishes a record again once its evidence time moves a minute past the published one; every native observation already changes meaning, so that rule adds nothing for native sessions.

Files this change edits that #1947 also edits: `packages/event-contracts/src/v2/families.ts`, `session-view.ts`, `fixtures/v2/session-cases.json`, `fixtures/v2/families.json`, `README.md`, `apps/runtime/src/core/session/{model,record,transition}.ts`, `core/store.ts`, `core/core.ts`, and the `bunny-runtime` and `bunny-message-profile` specifications. #1867 edits the Mac Codex hook wrapper, which this change does not touch.

## Risks and trade-offs

- The ordered branch of the reducer runs for the first time. The case set covers every native row with ordering, including delayed, duplicated and reordered delivery.
- Two session versions are live at once. The read function and the version selection are each one place, and a test keeps `3.1` equal to `3.0` apart from the identity, the notice result, `$id` and the description.
- A malformed observation would refuse its task change (decision 5). The tests cover every projection.
- Waiting tasks vanish from devices after a day without change (decision 8). That is the shared rule, stated rather than changed.

## Validation

From the worktree root with Node 24: `npm run build`, `npm run typecheck`, `npm run lint:js`, `npm run check:workflow`, `npm run test:workflow`, `npm run test:contracts`, `npm run test:contracts:python`, `npm run test:events:built`, `npm run test:events:python`, the runtime unit and scenario suites through `node scripts/native-test.mjs <script> --workers 4`, `test:companions:built`, `test:nanoleaf:built`, `test:tidbyt-module:built`, `test:lifx-module:built`, `test:pixoo:built` and the runtime dashboard checks for the changed names. Tests use synthetic tasks and the injected clock and scheduler. A disposable runtime exercise shows a synthetic task's states on the dashboard and runs the previous release's read helper (decision 11). Installed, client and physical acceptance stay with #1869.
