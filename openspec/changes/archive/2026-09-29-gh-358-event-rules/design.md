## Context

See proposal.md for motivation. The hub owns one private store (`owner.sqlite` as the lock, `state.sqlite` for agent state) opened by `HubStorage` under an exclusive lease. Controller commands go through one `ControllerClient` per device, and the 1.1 reads and the moment sender arrive separately in [#576](https://github.com/jimmie-potts/agent-device-hub/issues/576) and [#335](https://github.com/jimmie-potts/agent-device-hub/issues/335). The owner recorded three decisions for this story on 2026-09-29 (issue comment): relational tables in `state.sqlite`, the existing control-scope and `X-Pixoo-Request: 1` write guard, and stored arbitration settings with ADR 0006 defaults so #294 and #295 are not prerequisites. This design is cross-cutting (storage, a new internal interface, device hand-off and privacy), so the schema's design criterion applies.

## Goals / Non-Goals

**Goals:** durable owner-edited rules and interrupt set; one intake with no replay; deterministic, logged arbitration; hand-off through a sender interface that #335 can satisfy unchanged; bounded storage and work.

**Non-Goals:** routines (#359), a page or MCP tools (#360), GitHub and calendar sources (#293, #298), choreographed palettes (#297), the full moment log view (#296), personas (#294), agent proposals (#295), and sending moments directly.

## Decisions

### Storage lives on the owner lease
`AutomationStore` wraps the lease's `state.sqlite` connection. It creates `rules`, `interrupt_set`, `automation_settings`, `automation_meta`, `automation_events` and `automation_log`, and seeds the interrupt set and settings in one transaction guarded by a meta row, so seeding happens once. Every access checks that the lease is still held. The store uses synchronous `node:sqlite` calls and never holds a transaction across an `await`. It therefore cannot interleave with agent-state commits on the same connection. Stored rows are validated when read, and an invalid row fails startup with `invalid-state`, as agent state does. *Alternatives:* a JSON blob inside the agent-state payload was rejected by the owner, and a separate database file would need its own lock and fence.

### Intake is synchronous and evaluation is serial
`submit(event)` validates the event and drops `replay` deliveries. It drops IDs already seen (a bounded in-memory set of 4,096 in front of `automation_events`, which keeps the newest 10,000). It persists every accepted key before evaluation, so a crash or restart never evaluates the event twice, even one that matched no rule when it first arrived (review finding C1). It then returns at once, and sources never wait for devices. Accepted events join a bounded queue of 32 and are evaluated one at a time. Serial evaluation keeps budget counts exact without reservations, and a burst is small at personal scale. A full queue logs each matching rule as blocked with `capacity`. *Alternative:* concurrent evaluation with budget reservations adds state for no current need.

### Arbitration inputs
Settings and the interrupt set are cached in memory and written through. Budgets count flourish moments already handed to the sender, read from `automation_log` for the last hour, so they survive restarts. Target state comes from an injected reader that returns a device-neutral presentation (`status`, `content`, `quiet` or `unknown`), an alert state (`active`, `none` or `unknown`) and a moment capability (`supported`, `unsupported`, `1.0-only` or `unknown`). The composed reader uses #576's negotiated `snapshot('1.1')`. A 1.0 answer is `1.0-only`, and a 1.1 answer gives the declared `moments.supported`. The reader maps the desired mode (Work and Monitor to status, Free and Media to content, Quiet to quiet). A target that cannot play moments is blocked before the other target checks, so the log names the real reason rather than handing the sender a moment it would refuse. The generic controller snapshot carries no alert, so the composed reader takes the alert from the hub's own agent state: `active` while any session has outstanding attention. That is the hub's best evidence. The device's precedence at execution stays authoritative, and unknown values never block at the hub. Quiet hours use `HH:MM` start and end in an IANA time zone, or the host's zone when none is set. A window whose end precedes its start crosses midnight.

### Moment identity, start and hand-off
The moment ID is `m-` plus 40 hex characters of SHA-256 over the rule ID, source and event ID. It is neutral, stable across targets, and distinct per rule, so the device's duplicate memory treats each rule's moment separately. One hub-monotonic start instant (`performance.now()` plus a 1,000 ms lead) is computed after the target reads and passed to every call. The sender interface is exactly the #335 shape: one call takes `{moment:{momentId, mood, palette?, durationMs, priorityClass, coversStatus}, target, startAt}` and resolves one of `receipt`, `not-sent` (with `1.0-only`, `moments-unsupported`, `unsupported-capability`, `capacity` or `unavailable`) or `uncertain`, each carrying `momentId` and `start`. Calls fan out with `Promise.allSettled`. A rejected call is logged as `uncertain` with `sender-error`, and a malformed result as `uncertain` with `invalid-result`. Until #335 merges, `startHub` composes no sender and logs `sender-unavailable`, so the installed hub cannot reach a device through rules. Wiring the real sender is the one remaining step.

### Routes and authority
One route module handles `/api/automation/v1/rules`, `rules/:id`, `rules/:id/enable`, `rules/:id/disable`, `interrupt-set`, `settings` and `log`. The hub's shared guard applies unchanged: `read` for GET, `control` for writes, loopback Host and Origin, and `X-Pixoo-Request: 1` on every non-GET request, which the issue text states correctly. Creating, updating or enabling a rule also needs every target in the caller's `devices`, so a token cannot automate a device it cannot command. Removing or disabling a rule needs only `control`. The routes are the owner's explicit path; any other in-process creator gets a disabled rule. Rule IDs are `rule-<uuid>`, with at most 64 rules.

### Lifecycle as the first source
After `owner.ingest` returns `applied`, the ingest route submits `{source:'agent-lifecycle', kind:'agent.<kind>', id:<lifecycle deduplication key>, agent:<hash of the session selector>, task:<known turn ID>, delivery:'live'}`. Submission is synchronous, cannot throw into ingest, and does not change the ingest response.

## Risks / Trade-offs

- [The composed alert is agent-state attention, not the device's own alert] → The device's precedence still pre-empts and blocks. The reader is injectable, so a later contract field can replace it.
- [Serial evaluation delays a second event behind a slow device] → Each hand-off is bounded by the sender's own caps. The queue is bounded, and overflow is logged, not silently dropped.
- [Every accepted event adds one small synchronous commit, including each applied lifecycle event] → The insert is tiny next to the agent-state commit the same event already makes, and the hub, not each source, owns removing duplicates (ADR 0006). The 10,000-key bound covers far more than any restart window.
- [Rules do not move with a released-state migration] → The owner recreates them through the routes on the new owner. Revisit if migration is used again with rules installed.
- [Titles may appear in rule names] → Allowed by the #424 policy. The credential canary in display-text validation rejects recognizable secrets, and events and the log carry no free text beyond rule names.

## Migration Plan

Source-only. On the first start with this code, the new tables are created and seeded on the installed store without touching the agent-state payload. Rollback to an older hub leaves the extra tables unused, and they are ignored. No rule exists until the owner creates one, so behavior is unchanged until then. Enabling a rule on the installed hub and any live moment are separately authorized.

## Open Questions

None that change the specs. Canonical optional title fields on the event (#426) can be added to the intake event later as optional display fields.
