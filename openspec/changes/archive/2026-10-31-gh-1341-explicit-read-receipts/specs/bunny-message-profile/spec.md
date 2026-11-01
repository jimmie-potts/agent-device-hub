## ADDED Requirements

### Requirement: Explicit client read receipts use an opt-in lifecycle version

The contract SHALL provide lifecycle/2.1 as an explicitly selected extension of lifecycle/2.0 within message profile 2.0. It SHALL accept the existing lifecycle observations and a closed `read-receipt-observed` event. The new event SHALL name the owner-assigned session generation and finished notice, a known turn, and receipt provenance. The session identity SHALL retain its provider, client, host, source and native session ID. A provider-client receipt SHALL identify the Desktop reader and the opaque revisions seen and accepted by that client. An application-owned UI receipt SHALL identify its opaque view revision. These revisions SHALL NOT imply chronology or human comprehension. Only an observed successful read action after a completed turn qualifies as a provider-client receipt; a snapshot, rendering callback, output event or missing unread marker does not qualify.

Provider revisions SHALL preserve opaque tokens of 1–128 ASCII letters, digits, underscores, periods, hyphens or colons, including native `initial:<thread-id>` tokens. Whitespace, empty and oversized tokens SHALL be refused. Application-owned view revisions SHALL retain the shared identifier rule. Token shape alone SHALL NOT establish a read action.

Receipt observations SHALL carry unknown parentage without changing known session parentage. They SHALL carry no prompt, reply, transcript content, title, archive metadata or credential field. Unknown fields and unknown turn identity SHALL be refused. Default core-family registration SHALL remain unchanged and SHALL reject lifecycle/2.1 with `unsupported-version`; explicit registration SHALL be required. Existing lifecycle/2.0, session/2.0 and retained 1.x behavior SHALL remain unchanged.

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

### Requirement: Read receipt eligibility is scoped to an observed finished notice

The contract SHALL provide a pure reference decision for a received receipt, a caller-supplied source qualification and the current owner session. The reference SHALL validate the message before inspecting it and SHALL require qualification to match the message source, full producer feed and receipt kind. Qualification is a caller-established fact, not a field the producer can grant itself. The current session SHALL match the entire identity, generation, known turn and named turn-ended notice; its activity SHALL be idle or interrupted and it SHALL NOT be a known child. Missing or mismatched evidence SHALL remain ineligible. Only an eligible receipt can support a later consumer's read policy for that finished notice.

The decision SHALL NOT mutate the input, create a session, clear attention, acknowledge another consumer's notice, publish a state event, change freshness or write provider read state. Lifecycle freshness SHALL remain distinct from receipt eligibility. A future owner SHALL recheck eligibility within its own serialized state operation and supply current qualification; this reference alone establishes no installed provider, authenticated transport, state-consumer or device acceptance.

#### Scenario: A receipt matches a qualified finished session
- **WHEN** the source, feed, receipt kind, current session, generation, known turn and finished notice match, and the session is idle or interrupted
- **THEN** the reference reports eligible for that notice
- **AND** it changes no state

#### Scenario: Unqualified or mismatched source
- **WHEN** qualification is missing or its source, provider, client, host, source ID or receipt kind differs
- **THEN** the reference reports an unqualified source

#### Scenario: Receipt for an obsolete target
- **WHEN** the session is absent or its identity, generation, known turn or finished notice differs
- **THEN** the reference does not report eligible
- **AND** no newer notice can be cleared by that receipt

#### Scenario: Running or uncertain completion
- **WHEN** the session is a known child, is working, has unknown activity or turn, or lacks the named completed-turn notice
- **THEN** the receipt remains ineligible

#### Scenario: Independent freshness
- **WHEN** a qualified receipt matches an idle completed session whose lifecycle observation is stale or restart-uncertain
- **THEN** eligibility is evaluated for the exact finished notice without refreshing lifecycle evidence or declaring connectivity
