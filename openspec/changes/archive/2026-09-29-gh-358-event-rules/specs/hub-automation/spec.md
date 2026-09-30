## Purpose

Let the standalone hub run owner-approved event rules that turn normalized events into arbitrated moments, without an open conversation, a model call or device-specific policy in the hub.

## ADDED Requirements

### Requirement: Durable rules, interrupt set and settings
The hub SHALL keep event rules, the interrupt set and the automation settings in its private store, under the same exclusive owner lease as agent state. Each rule SHALL have a stable ID, a name, an enabled flag, the kind `event`, a validated trigger and action, and created and updated times. The kind `routine` is reserved and SHALL be rejected. On first start, the hub SHALL seed the interrupt set with `pull-request.merged`, `ci.failed` and `meeting.reminder`, and the settings with the ADR 0006 defaults: flourishes allowed, quiet hours off, at most 1 flourish per agent task, 2 per agent per hour and 6 per hour overall, and 5 minutes between flourishes on one device. It SHALL seed each exactly once, so an owner's later edit, including an empty interrupt set, survives every restart.

#### Scenario: Restart keeps owner data
- **WHEN** the owner creates rules, replaces the interrupt set and changes settings, and the hub restarts on the same store
- **THEN** the rules, the interrupt set and the settings read back unchanged, and the defaults are not seeded again

#### Scenario: First start seeds defaults
- **WHEN** the hub starts on a new store
- **THEN** the interrupt set holds the three owner-approved kinds and the settings hold the ADR 0006 defaults

### Requirement: Typed automation routes
The hub SHALL serve rules, the interrupt set, the settings and the log only under `/api/automation/v1/`, through its existing REST authorization. Reads SHALL need `read` scope. Writes SHALL need `control` scope and the `X-Pixoo-Request: 1` header that every hub REST mutation requires. Creating, updating or enabling a rule SHALL also need every target alias in the caller's `devices`. Invalid input SHALL be rejected with a typed error code and no state change: `invalid-rule` for the envelope or name, `invalid-trigger`, `invalid-action`, `unknown-target` for an alias the hub does not route, `invalid-interrupt-set` and `invalid-settings`. A missing rule SHALL answer `unknown-rule`. Writes SHALL be refused while the hub is a staged migration destination or has released its state.

#### Scenario: Scope and header enforcement
- **WHEN** a caller without `read` scope reads, a caller without `control` scope writes, or a write omits `X-Pixoo-Request: 1`
- **THEN** the hub answers 401 or 403 and changes nothing

#### Scenario: Invalid trigger or action
- **WHEN** a create or update carries an unknown field, an event kind outside the grammar, a duration outside 1,000 to 300,000 ms, a malformed palette, a duplicate or unrouted target, or the reserved kind `routine`
- **THEN** the hub answers 400 with the matching typed code and stores nothing

#### Scenario: Target outside the caller's devices
- **WHEN** a control credential creates, updates or enables a rule that targets an alias outside its `devices`
- **THEN** the hub answers 403 and the rule is unchanged

### Requirement: Owner approval of rules
Only an explicit owner call through the typed routes SHALL store a rule as given. A rule created by any other path SHALL be stored disabled, whatever it requests.

#### Scenario: Non-owner creation
- **WHEN** an in-process caller that is not the owner's route creates an enabled rule
- **THEN** the stored rule is disabled and no event triggers it until the owner enables it

### Requirement: Event intake without replay
The hub SHALL accept normalized events from in-process sources through one intake. Each event carries a stable ID, a source, a kind, an optional source alias, optional neutral agent and task IDs, and an explicit `live` or `replay` delivery. The intake SHALL drop an event whose ID the same source already submitted in this run. It SHALL also drop one that matched a stored rule before a restart, because it persists the ID of every event that matches a rule before evaluating it. An event that matches no rule has no effect. It SHALL drop every `replay` event before any rule, and SHALL accept nothing while the hub is staged, closing or released. Newly applied agent lifecycle events SHALL reach the intake as the source `agent-lifecycle` with the kind `agent.<lifecycle kind>`. Duplicate, stale and rejected lifecycle events SHALL NOT reach it. Intake SHALL never delay or fail lifecycle ingest.

#### Scenario: Duplicate event
- **WHEN** a source submits the same event ID twice, before or after a hub restart
- **THEN** only the first submission is evaluated, and the second produces no send and no log entry

#### Scenario: Replayed history
- **WHEN** a source submits a stream of `replay` events that match enabled rules
- **THEN** no rule is evaluated, nothing is sent and nothing is logged

### Requirement: Moment derivation
For each enabled rule whose trigger matches an event's source and kind, and its source alias when the trigger names one, the hub SHALL derive one moment. The moment has the rule's mood, palette, duration and priority class, and a neutral moment ID derived from the rule and event, identical for every target. `coversStatus` SHALL be true only when the priority class is `event` and the event kind is in the interrupt set at evaluation time. A disabled rule SHALL produce nothing.

#### Scenario: Kind in the interrupt set
- **WHEN** an event whose kind is in the interrupt set matches an enabled `event` rule with two targets
- **THEN** each target is handed the same moment once, with `coversStatus` true

#### Scenario: Kind outside the interrupt set
- **WHEN** the event kind is not in the interrupt set
- **THEN** each target is handed the moment with `coversStatus` false

### Requirement: Arbitration order and blocking
Before any hand-off, the hub SHALL check each moment in this order: the global no-flourish switch (flourish class only), quiet hours in the configured time zone (every class), the per-agent task, per-agent hourly and overall hourly flourish budgets (flourish class only), and then for each target whether it can play moments at all, the per-device flourish spacing, a quiet presentation, and an active alert on status presentation. The first failing check SHALL block the moment, or for a target check that target only, with the reason `no-flourishes`, `quiet-hours`, `agent-task-budget`, `agent-hourly-budget`, `global-hourly-budget`, `1.0-only`, `moments-unsupported`, `device-spacing`, `quiet` or `alert`. The hub SHALL read a target's capability and presentation through the negotiated contract 1.1 read: a controller that answers only at 1.0 is `1.0-only`, and a 1.1 snapshot declaring `moments` unsupported is `moments-unsupported`. A target the hub no longer routes SHALL be blocked as `unknown-target`. A blocked moment SHALL be logged for each affected target and SHALL NOT be sent. An unknown presentation or alert SHALL NOT block the moment at the hub, because the device's own precedence still applies.

#### Scenario: Each blocking reason
- **WHEN** the switch, quiet hours, each budget, a 1.0-only target, a target without moments, a Quiet target or a status target with an active alert applies
- **THEN** the log records that reason for each affected target and no target is handed the moment

### Requirement: Independent delivery hand-off
The hub SHALL hand each arbitrated moment to the single-device moment sender once per unblocked target, concurrently. Every call SHALL carry the same hub-monotonic start instant. One target's failure, not-sent result, uncertain result or thrown error SHALL NOT prevent or delay the hand-off to another target. The hub SHALL never retry a hand-off. Without a composed sender, every unblocked target SHALL be logged as blocked with `sender-unavailable`. The hub SHALL send only semantic intents and SHALL NOT change any device's selected mode.

#### Scenario: Mixed results
- **WHEN** one target's send throws, another answers a receipt with `moment-blocked`, `moment-missed` or `unsupported-capability`, and a third is sent
- **THEN** every target is handed over exactly once, and each result is logged for its own target

### Requirement: Bounded private automation log
The hub SHALL keep a bounded automation log in its private store. Each entry SHALL record the time, rule ID, event source, ID, kind and alias, the moment ID, priority class and `coversStatus`, the target alias, and one outcome: `blocked` with its reason, `receipt` with the receipt's request ID, outcome, prior effects and any failure code, `not-sent` with its typed reason, or `uncertain`. The log and rules SHALL hold no credentials or tokens. Rule names SHALL be bounded display text that rejects recognizable credential patterns. The log SHALL be readable newest first through the log route, with a bounded page size.

#### Scenario: Privacy of stored content
- **WHEN** a rule name contains a bearer token or a sender result carries fields beyond the receipt projection
- **THEN** the rule is rejected, or the extra fields are not stored or returned
