## Purpose

Turn bounded, supported diagnostic findings into attributable maintenance selections for the existing serial delivery owner, preserving private evidence and truthful installed completion.

## ADDED Requirements

### Requirement: Bounded canonical diagnostic input

The intake SHALL read only configured user units and time windows, enforce row, byte and time limits, and validate each accepted message against the released diagnostic contract. It SHALL retain accepted original records privately and report missing, malformed, rotated or capped coverage without claiming healthy operation.

#### Scenario: Failure record within the selected window
- **WHEN** an allowlisted unit emits a valid failure record within the query window
- **THEN** the private evidence contains that original record and the finding groups only registered diagnostic dimensions

#### Scenario: Untrusted or incomplete journal output
- **WHEN** output is malformed, oversized, outside scope or truncated by a limit
- **THEN** the intake reports incomplete coverage and no text from that output becomes a command, repository selection or public issue instruction

### Requirement: Evidence-backed issue selection

The intake SHALL investigate findings against current repository source and existing work, reassess project direction, contracts and reuse, and use the installed planning method. Expected failures, speculative changes and performance claims without representative evidence SHALL remain unselected. New issue descriptions SHALL use a separately sanitized publication representation and retain private originals outside GitHub.

#### Scenario: Supported finding already has an issue
- **WHEN** investigation identifies an existing eligible issue for the same supported finding
- **THEN** the intake reuses that exact issue and does not create a duplicate

#### Scenario: Unsupported improvement
- **WHEN** the finding cannot establish a concrete defect or a performance baseline
- **THEN** the report preserves the uncertainty and no implementation selection is produced

### Requirement: Reconcile external effects before retrying

The intake SHALL persist its original run identity, evidence and publication intent before creating an issue. An interrupted or ambiguous creation SHALL require authoritative lookup before any retry. Repeated input SHALL preserve the prior issue and queue disposition rather than reopen completed work automatically.

#### Scenario: Lost issue creation response
- **WHEN** GitHub accepted an issue but the process lost the response
- **THEN** reconciliation finds the existing issue by its exact intake marker and returns its identity without creating another issue

#### Scenario: Ambiguous recovery
- **WHEN** lookup fails or more than one issue matches an in-flight publication
- **THEN** that finding remains uncertain and the intake does not repeat the mutation

### Requirement: One authorized execution owner

The intake SHALL run as the shared supervisor's bounded trusted intake step and return exact selections under its configured maintenance authority. It SHALL not start another scheduler, weaken permissions or run an independent delivery writer. Owner-selected queues and maintenance selection SHALL retain separate grants. The original deadline and global context bound SHALL include intake work.

#### Scenario: Authorized maintenance selection
- **WHEN** the supervisor invokes intake under a matching maintenance grant
- **THEN** each returned selection identifies an allowed repository, positive issue number and the same authority, with no executable command supplied by findings

#### Scenario: Uncertain or expired invocation
- **WHEN** an invocation lacks its configured grant, is past its deadline or is a recovery of an uncertain run
- **THEN** intake refuses new mutations or performs read-only reconciliation as appropriate

### Requirement: Completion remains tied to installed evidence

The report SHALL distinguish findings, selected issues, queue admission, merged source, installed verification and pending outcomes. It SHALL consume the execution owner's attributable receipts without treating a model response, queue admission or source merge as installed success. Required review, CI, compatibility and installation failures SHALL remain blocking.

#### Scenario: Issue has only been queued
- **WHEN** intake creates or reuses an issue and returns it for execution
- **THEN** the report identifies selected work without claiming a merged or installed fix

#### Scenario: Delivery is interrupted or installation is refused
- **WHEN** the execution owner reports a pending or uncertain result
- **THEN** the report preserves that result and its next action rather than closing the issue

### Requirement: Private retention and publication boundaries

The intake SHALL preserve accepted private evidence until an explicit owner-selected retention or clearing rule applies. It SHALL keep credentials excluded and public fixtures synthetic. Derived findings, execution queues and queries MAY be bounded without representing a complete source archive. Capacity refusal SHALL be visible and SHALL NOT silently delete retained evidence.

#### Scenario: Private identifiers in a valid record
- **WHEN** a valid diagnostic record contains an identifier that is unnecessary for a public reproduction
- **THEN** private evidence retains it and the publication representation excludes it

#### Scenario: Existing evidence exceeds capacity
- **WHEN** a new intake cannot safely persist its evidence within the configured capacity
- **THEN** new admission is refused with a recorded reason and existing evidence is preserved
