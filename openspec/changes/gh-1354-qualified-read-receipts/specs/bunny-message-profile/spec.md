## MODIFIED Requirements

### Requirement: Explicit client read receipts use an opt-in lifecycle version

The contract SHALL provide lifecycle/2.1 as an explicitly selected extension of lifecycle/2.0 within message profile 2.0. It SHALL accept the existing lifecycle observations and a closed `read-receipt-observed` event. The new event SHALL name the owner-assigned session generation and finished notice, a known turn, and receipt provenance. The session identity SHALL retain its provider, client, host, source and native session ID. A provider-client receipt SHALL identify the Desktop reader and the opaque revisions seen and accepted by that client. An application-owned UI receipt SHALL identify its opaque view revision. These revisions SHALL NOT imply chronology or human comprehension. Only an observed successful read action after a completed turn qualifies as a provider-client receipt; a snapshot, rendering callback, output event or missing unread marker does not qualify.

Provider revisions SHALL preserve opaque tokens of 1–128 ASCII letters, digits, underscores, periods, hyphens or colons, including native `initial:<thread-id>` tokens. Whitespace, empty and oversized tokens SHALL be refused. Application-owned view revisions SHALL retain the shared identifier rule. Token shape alone SHALL NOT establish a read action.

Receipt observations SHALL carry unknown parentage without changing known session parentage. They SHALL carry no prompt, reply, transcript content, title, archive metadata or credential field. Unknown fields and unknown turn identity SHALL be refused. Default core-family registration SHALL reject lifecycle/2.1 with `unsupported-version`; explicit registration SHALL be required. Existing lifecycle/2.0, session/2.0 and retained 1.x behavior SHALL remain unchanged.

#### Scenario: Qualified identity remains unchanged
- **WHEN** an explicit validator receives a conforming receipt for `codex/local` or `claude/code`
- **THEN** it accepts the metadata without relabeling the session as `codex/desktop`
- **AND** the same payload is rejected under lifecycle/2.0

#### Scenario: Native initial revision
- **WHEN** a qualified explicit action has a native `initial:<thread-id>` seen revision, an accepted revision and a matching finished target
- **THEN** the receipt validates and is eligible without altering the opaque token
- **AND** an initial snapshot alone still supplies no qualified action

#### Scenario: Existing observations remain compatible
- **WHEN** an explicit lifecycle/2.1 validator receives an existing valid lifecycle/2.0 observation under the new schema URI
- **THEN** it accepts the observation with the original identity, parentage and ordering checks

#### Scenario: The extension is not activated by package installation
- **WHEN** only the existing default core-family registration is selected
- **THEN** a lifecycle/2.1 receipt is rejected as `unsupported-version`
- **AND** no runtime owner or provider read state changes

#### Scenario: Incomplete or expanded receipt payload
- **WHEN** a receipt omits its provenance, generation, notice or known turn, combines provenance variants, adds content or credentials, or names a wrong identity subject or ordering authority
- **THEN** it is refused by the schema or the existing shared error conventions

## ADDED Requirements

### Requirement: Versioned session output retains explicit receipt provenance

The contract SHALL provide session/2.1 for a session with explicit read provenance. It SHALL retain the session identity and include the exact finished notice, receipt observation time, authenticated source and receipt. Positive non-Desktop read evidence SHALL require this provenance. Provenance SHALL match the session's known turn and notice and SHALL apply only to an idle or interrupted root session. It SHALL carry no content or credential fields.

Current core-family registration SHALL include session/2.1 for consumers. Lifecycle/2.1 SHALL remain an explicit intake selection. Session/2.0, lifecycle/2.0 and retained 1.x schemas SHALL retain their existing acceptance rules.

#### Scenario: Qualified Claude output
- **WHEN** the owner publishes a read Claude session with matching receipt provenance under session/2.1
- **THEN** current consumers validate it without relabeling its identity
- **AND** session/2.0 still rejects that same positive read

#### Scenario: Invalid provenance
- **WHEN** read provenance has an unknown or mismatched turn or notice, belongs to a child or active session, omits its source, or contains undeclared fields
- **THEN** validation refuses the record

