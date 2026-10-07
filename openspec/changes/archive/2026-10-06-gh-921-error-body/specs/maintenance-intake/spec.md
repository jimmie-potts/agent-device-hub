## MODIFIED Requirements

### Requirement: One authorized execution owner

The intake SHALL run as the shared supervisor's bounded trusted intake step and return exact selections under its configured maintenance authority. It SHALL not start another scheduler, weaken permissions or run an independent delivery writer. Owner-selected queues and maintenance selection SHALL retain separate grants. The original deadline and global context bound SHALL include intake work.

A refusal SHALL return a `blocked` response that keeps its 1.x `schemaVersion`, `status`, `selections` and `reason` and adds `error`, the shared registry error body. The body SHALL carry the registry code mapped from the reason, that code's registry `retryable` flag, and the reason as `detail`. A configuration that is missing, invalid or no longer matches its pinned fingerprints SHALL carry `invalid-state`, and a malformed invocation or request SHALL carry `invalid-request`, under the same reason. `complete` and `uncertain` responses SHALL keep exactly their 1.x fields. Until 1.x retires, the body SHALL only be added: no 1.x field is removed or changed.

#### Scenario: Authorized maintenance selection
- **WHEN** the supervisor invokes intake under a matching maintenance grant
- **THEN** each returned selection identifies an allowed repository, positive issue number and the same authority, with no executable command supplied by findings

#### Scenario: Uncertain or expired invocation
- **WHEN** an invocation lacks its configured grant, is past its deadline or is a recovery of an uncertain run
- **THEN** intake refuses new mutations or performs read-only reconciliation as appropriate

#### Scenario: Refusal carries the registry error body
- **WHEN** intake refuses an invocation that lacks its configured grant or is past its deadline
- **THEN** the `blocked` response keeps its 1.x fields and its `error` carries `forbidden` or `expired`, not retryable, with the reason as `detail`

#### Scenario: Operator configuration fails to load
- **WHEN** the configuration file is missing or invalid, or a pinned file no longer matches its fingerprint
- **THEN** the response is `blocked` with reason `invalid-or-unavailable-intake` and an `invalid-state` body, while a malformed request under the same reason carries `invalid-request`

#### Scenario: Accepted responses are unchanged
- **WHEN** intake completes its selection decisions or leaves a publication uncertain
- **THEN** the response carries exactly `schemaVersion`, `status`, `selections` and `reason`, with no error body
