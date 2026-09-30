## Purpose

Let the standalone hub run owner-approved event rules that turn normalized events into arbitrated moments, without an open conversation, a model call or device-specific policy in the hub.

## Requirements

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
The hub SHALL accept normalized events from in-process sources through one intake. Each event carries a stable ID, a source, a kind, an optional source alias, optional neutral agent and task IDs, and an explicit `live` or `replay` delivery. The intake SHALL persist the source and ID of every accepted `live` event before evaluating it, keeping at least the newest 10,000, and SHALL drop an event whose ID the same source already submitted, before or after a restart, including one that matched no rule when it first arrived. It SHALL drop every `replay` event before any rule, and SHALL accept nothing while the hub is staged, closing or released. Newly applied agent lifecycle events SHALL reach the intake as the source `agent-lifecycle` with the kind `agent.<lifecycle kind>`. Duplicate, stale and rejected lifecycle events SHALL NOT reach it. Intake SHALL never delay or fail lifecycle ingest.

#### Scenario: Duplicate event
- **WHEN** a source submits the same event ID twice, before or after a hub restart, even when a matching rule is created between the two submissions
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
Before any hand-off, the hub SHALL check each moment in this order: the global no-flourish switch (flourish class only), quiet hours in the configured time zone (every class), the per-agent task, per-agent hourly and overall hourly flourish budgets (flourish class only), and then for each target whether it can play moments at all, the per-device flourish spacing, a quiet presentation, and an active alert on status presentation. The first failing check SHALL block the moment, or for a target check that target only, with the reason `no-flourishes`, `quiet-hours`, `agent-task-budget`, `agent-hourly-budget`, `global-hourly-budget`, `1.0-only`, `moments-unsupported`, `device-spacing`, `quiet` or `alert`. The hub SHALL read a target's capability and presentation through the negotiated contract 1.1 read: a controller that answers only at 1.0 is `1.0-only`, and a 1.1 snapshot declaring `moments` unsupported is `moments-unsupported`. A target the hub no longer routes SHALL be blocked as `unknown-target`. A blocked moment SHALL be logged for each affected target and SHALL NOT be sent. The hub SHALL evaluate accepted events one at a time from a bounded queue; an event that arrives while the queue is full SHALL be logged as blocked with `capacity` for each target of each matching rule. An unknown presentation or alert SHALL NOT block the moment at the hub, because the device's own precedence still applies.

#### Scenario: Each blocking reason
- **WHEN** the switch, quiet hours, each budget, a 1.0-only target, a target without moments, a Quiet target or a status target with an active alert applies
- **THEN** the log records that reason for each affected target and no target is handed the moment

### Requirement: Independent delivery hand-off
The hub SHALL hand each arbitrated moment to the shared single-device moment sender, bound to each target's own controller client, once per unblocked target, concurrently, and SHALL run that hand-off outside every request's response path. Every call SHALL carry the same hub-monotonic start instant. One target's failure, not-sent result, uncertain result or thrown error SHALL NOT prevent or delay the hand-off to another target. A thrown error SHALL be logged as `uncertain` with `sender-error`, and a result outside the sender's typed shape as `uncertain` with `invalid-result`. The hub SHALL never retry a hand-off. Without a composed sender, every unblocked target SHALL be logged as blocked with `sender-unavailable`. The hub SHALL send only semantic intents and SHALL NOT change any device's selected mode.

#### Scenario: Mixed results
- **WHEN** one target's send throws, another answers a receipt with `moment-blocked`, `moment-missed` or `unsupported-capability`, and a third is sent
- **THEN** every target is handed over exactly once, and each result is logged for its own target

### Requirement: Bounded private automation log
The hub SHALL keep a bounded automation log in its private store. Each entry SHALL record the time, rule ID, event source, ID, kind and alias, the moment ID, priority class and `coversStatus`, the target alias, and one outcome: `blocked` with its reason, `receipt` with the receipt's request ID, outcome, prior effects and any failure code, `not-sent` with its typed reason and any contract failure code, or `uncertain`. The log and rules SHALL hold no credentials or tokens. Rule names SHALL be bounded display text that rejects recognizable credential patterns, and moods, aliases and event IDs SHALL be rejected when a word in them starts with a recognizable token prefix. The log SHALL be readable newest first through the log route, with a bounded page size.

#### Scenario: Privacy of stored content
- **WHEN** a rule name contains a bearer token or a sender result carries fields beyond the receipt projection
- **THEN** the rule is rejected, or the extra fields are not stored or returned

### Requirement: Bounded event display metadata
The existing normalized event intake SHALL optionally accept `pullRequestTitle` and `meetingTitle`, each at most 160 Unicode scalars, and `repositoryName`, at most 80. Each present field SHALL be nonempty display text that passes the shared lifecycle contract's Unicode, control-character and recognizable-credential checks. Invalid or overlong metadata and undeclared content fields SHALL reject the event as `invalid-event` before consuming its deduplication key. Absent fields SHALL preserve legacy event behavior. Display metadata SHALL NOT change event matching, identity, replay protection, arbitration or the controller contract 1.1 sender intent. The lifecycle source SHALL continue to supply neutral IDs without capturing additional content.

Only own data properties SHALL supply display metadata. Inherited fields SHALL be omitted, and metadata accessors SHALL be rejected without being invoked. The intake SHALL validate the same values it copies into the normalized event.

#### Scenario: Named pull request and meeting moments
- **WHEN** a live event carries a valid pull request title and repository name, or a valid meeting title, and matches an enabled rule
- **THEN** each target's private log entry includes those fields in its event, including when arbitration blocks delivery
- **AND** the sender receives only the existing controller moment intent fields

#### Scenario: Invalid metadata leaves the event ID available
- **WHEN** an event supplies a recognizable credential, empty text, invalid Unicode, a control character, a value beyond its scalar bound, or an undeclared prompt, response, transcript or attendee field
- **THEN** the intake returns `invalid-event`, stores no log entry and sends nothing
- **AND** a later valid event with the same source and ID may be evaluated once

#### Scenario: Restart and legacy log compatibility
- **WHEN** the Hub reopens its private store containing legacy log rows and named event rows
- **THEN** legacy rows retain their prior shape and named rows return the same optional display fields without inferred or backfilled names
- **AND** renamed metadata on an already accepted event remains a duplicate, and replayed named events trigger no rule

#### Scenario: Metadata remains private and allowlisted
- **WHEN** an accepted named event is logged with sender evidence
- **THEN** the existing bounded log stores only its declared display fields beside the allowlisted sender projection under the existing owner lease
- **AND** metadata alone creates no new table, live-state migration, credential exposure, content-capture capability or device writer

#### Scenario: Source objects cannot bypass metadata validation
- **WHEN** an in-process source supplies inherited display metadata or an accessor for a display field
- **THEN** inherited fields are not copied, and accessors reject the event without being invoked
- **AND** unchecked credentials or overlong values cannot enter the log through either path
