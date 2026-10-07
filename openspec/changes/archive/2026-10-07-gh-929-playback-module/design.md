## Context

Sources read at pickup on 2026-10-07, main `483d3a93`, then rebased onto `a8e8bb0` (#953's safe-error lint): the issue and
its hand-offs from #918 (the `playback` record's `id` is a routing ID; `playback-control` on
`bunny.cmd.playback-control.<id>`) and #919 (module API 1.1, `configure`, the kit's opt-in `offline` check);
[ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) "Failure isolation", "Errors, effects and outcomes" and
"Observability"; the old Hub's `apps/hub/src/playback.ts`, `sony.ts`, `sonos.ts`, `tests/playback.test.mjs` and the
`hub-playback` specification; architecture.md "Shared playback"; the SDK's module API, outbox, `DeviceAvailability`
and kit; the runtime's catalog, harness and disposable runs; and #840's per-store table (the saved playback preference
starts fresh). The issue stays aligned; the adjustments below are routine and within its scope.

## Goals / Non-Goals

**Goals:**
- One owner of the `playback` record that keeps the Hub's cadence, thresholds, ranking and command protections.
- Speaker errors and timeouts as outcomes and `unavailable` state, with one degradation and one recovery logged.
- A configuration section and a conversion of the Hub's block for the installer.
- Simulated speakers for tests, the catalog and disposable runs.

**Non-Goals:**
- The Windows media-session source (#36), pages, MCP tools and settings (#835's module API 1.2), the installer itself
  (#935), the core's outcome acknowledgment (#782), and removing the Hub's copy (#839).

## Decisions

- **One module for both speakers.** The ranking needs both observations in one owner, and modules cannot import each
  other. A source has no ID of its own; its records name it `<id>.<kind>`.
- **The transport is the protocol call.** `SpeakerTransport` makes one Sony JSON-RPC call or one Sonos SOAP action.
  `httpSpeakers()` is the Hub's `fetch` code; `SimulatedSpeakers` answers the same protocols, so the module's parsing
  runs in the catalog and in runs too. Alternative rejected: simulating normalized observations, which would leave the
  parsing out of every scenario.
- **Polling and deadlines move to the module, on the runtime's scheduler.** The Hub's sources polled on their own
  `setInterval` with their own timers; the module's timers are the runtime's, so a manual clock drives them in tests and
  the scenario harness, and the runtime cancels them at stop. Each poll schedules the next one first and skips a read
  still in progress, as the Hub's interval and read reuse did. Each call's deadline also ends at the module's stop.
- **Start begins the first reads without waiting.** Policy A forbids waiting on a device in start; starting the reads
  there lets a command right after start find the first observation, which the kit's accepted-command check relies on.
- **A revision for each change of availability or playback, and one at each start.** Republishing on every unchanged
  read would publish a state event that changed nothing every two seconds, which ADR 0012's "Repetition" rule forbids.
  So `observedAtMs` is the last read when the revision was published, and consumers judge freshness by `availability`,
  which the module publishes at each threshold through a timer. The Hub's snapshot gave the latest read's time and its
  age, so MAPPING.md's `ageMs` row now has no 2.0 home (review fix, PR #966). Each start publishes `unavailable` at a new revision,
  persisted in the module's database, so a restarted module never goes back in revision and a speaker offline at start
  is reported. Sync serves the last published record, so one revision never has two contents.
- **Commands keep the Hub's protections under the platform's rules.** Admission fixes the presented speaker; the action
  is sent once and never redirected or retried. The module stores the command's intent before the speaker hears it, so
  a repeated `requestId` after a crash is not sent again, and a start reports an intent with no outcome as `uncertain`
  (ADR 0012: stored intent is responsibility). The outcome commits with the command's result in the module's outbox,
  then the module replies `accepted`. A device refusal (a JSON-RPC error, a SOAP fault) means the speaker heard the
  command, so it is `failed` with `invalid-state` and evidence `transmitted`, as MAPPING.md's receipt rule gives a
  failure after a confirmed transmission (review fix, PR #966; evidence `none` would claim nothing reached it). An
  action the speaker has no command for is never sent: `failed` with evidence `none`. No answer is `uncertain` with
  `uncertain-result`. A transmitted command is `succeeded` with evidence `transmitted`, never `observed`.
- **The reply comes after the call and the outcome, an exception to "Replies answer a command immediately".** The
  responder handles one command at a time, so the next command is admitted only after the speaker answered or the
  1.5 s deadline passed, and its admission waits at most another 1.5 s for the read after the command ahead. A reply
  therefore comes within about 3 s, inside a requester's usual 5 s deadline, and a requester that hears `accepted` can
  already find the outcome. Alternative rejected: replying first and calling the speaker afterwards, which would need a
  busy refusal or a second queue of the module's own to keep one command at a time (review fix, PR #966).
- **A database refusal never escapes the module.** A refused intent refuses the command with `capacity` before any
  effect. A refused outcome, after the speaker heard the command, still gets `accepted`, because the command may have
  taken effect and the stored intent keeps the module responsible; the module commits the outcome again after 1 s,
  doubling to 60 s, and if it stops first, the next start reports the intent `uncertain`. Every commit shares one run of
  refusals: one `operation.failed`, then one `operation.completed` (review fix, PR #966).
- **One command at a time, by the SDK's queue.** The SDK's responder handles one command at a time, so a second command
  waits and is admitted against the speaker presented then; a command still queued at its deadline is `expired`. The
  Hub instead refused a concurrent command with `capacity`. Queueing is the platform's rule, and every command still
  reaches a speaker at most once. After each command the module reads that speaker again, and the next admission waits
  for that read, so a second pause behind a pause is refused rather than sent (review fix, PR #966).
- **Duplicates by `(source, requestId)`, bounded to 64.** As the Hub kept 64 receipts per principal. A different
  command under the same ID is `duplicate-conflict`, the registry's code for reused identity with other content.
- **The conversion carries order and addresses only.** The Hub keeps no saved preference, so nothing else exists to
  carry; the configured order applies (owner decision 10). A 1.x ID outside the routing-ID form is renamed by a fixed
  rule, and the result names the old ID for the installer's report.
- **The shipped runtime refuses the module without a configuration file.** #919's rule applies: health shows it
  `refused` with `not-found`, and the core runs. The shipped-process test and the log test now expect that.
- **The Hub's route tests are not carried.** Authentication, scopes, the browser launcher, the dashboard context and
  the staged host belong to the Hub's HTTP surface; in the runtime, the SDK edge's grants authenticate remote parts
  (#835).

## Risks / Trade-offs

- [Outcomes accumulate until the core acknowledges them (#782)] → Each start republishes them; the core drops
  duplicates. The rows are small.
- [The kit's accepted-command check depends on the first read finishing before the command's handler runs] → The
  simulated speaker answers at once and start begins the reads; a change that delays the first read fails the kit
  loudly with `unavailable`.
- [Real-time runs make the 30-second step slow] → The catalog scenario stops at `stale`; the module tests cover
  `unavailable` on a manual clock.
- [A database refusal while committing an outcome after the speaker heard the command] → The handler fails, the
  request is `uncertain`, and the next start reports the stored intent as `uncertain`.
