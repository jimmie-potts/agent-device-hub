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

### Requirement: Owning tracker reconciliation before closure

The owning closeout adapter SHALL validate the published installation receipt, exact merge and unchanged selected requirements. It SHALL independently assess complete current acceptance rather than trust the worker's acceptance classification. It SHALL read affected native and explicit trackers, assess criterion-specific evidence and remaining work, and preserve parent, client and physical obligations. Recommendation changes SHALL use the canonical parser, dry run and upsert. Current ownership, body, comments, relationships and Project fields SHALL be checked before effects and by authoritative readback. Unsupported semantic changes, incomplete reads or missing acceptance SHALL leave reconciliation pending without erasing verified installation.

#### Scenario: Worker omitted physical acceptance
- **WHEN** the worker declares source and installed completion but the current issue requires physical evidence
- **THEN** independent assessment blocks closure and retains the installation receipt separately

#### Scenario: Related parent still has pending acceptance
- **WHEN** the selected installed issue is accepted and a related parent has remaining client or physical criteria
- **THEN** the receipt preserves each remaining obligation, owner and next action, and the adapter does not close the parent

#### Scenario: Related recommendation needs refresh
- **WHEN** accepted prerequisites change the next action and current shared policy supports an updated recommendation
- **THEN** the adapter reviews and applies the canonical update, preserving unrelated text and Project fields, and verifies readback before claiming reconciliation complete

#### Scenario: Accepted source-only exception
- **WHEN** the reviewed issue explicitly accepts source-only completion with a reason and linked installation obligation and independent assessment confirms that scope
- **THEN** the adapter may close that source issue without invoking or inventing installation evidence, while retaining overall installation pending and the linked obligation

#### Scenario: Closeout effect loses its response
- **WHEN** publication, closure or a Project effect has an ambiguous result
- **THEN** retained intent requires read-only authoritative reconciliation without repeating the effect or claiming completion from installation alone

### Requirement: Existing Hub installation protocol

The Hub installation adapter SHALL bind the established owner, exact target, current native plan digest and original work deadline. It SHALL reuse the native installation operation and require at least 600 seconds before entry and immediately before durable mutation intent. It SHALL NOT kill an admitted switch or invent a second recovery engine. Lost responses SHALL reconcile retained intent, full published receipts and fresh process/health evidence without repeating upgrade. Active machinery changes, unknown migration and unresolved native barriers SHALL remain pending.

#### Scenario: Preparation consumes the available reserve
- **WHEN** staging or compatibility checks leave less than the native transition reserve
- **THEN** the native operation refuses before stopping the installed service

#### Scenario: Lost native upgrade response
- **WHEN** upgrade produced a valid terminal receipt but its response was lost
- **THEN** reconciliation reads that attempt's receipt and fresh running evidence without issuing another upgrade

#### Scenario: Native operation safely refused or recovered
- **WHEN** a valid terminal receipt records refusal or rollback and current baseline identity and health are verified with no remaining barrier
- **THEN** the supervisor may park the failed delivery without claiming the requested revision was installed
