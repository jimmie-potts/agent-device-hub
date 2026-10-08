## ADDED Requirements

### Requirement: The 2.0 agent hook script

`apps/runtime/bin/monitor-hook.mjs` SHALL be the 2.0 agent hook. Run as a client's hook command, `node monitor-hook.mjs <producer file>` with the hook's JSON on stdin, it SHALL read the producer file (see "The producer file, unchanged"), normalize the hook with agent-state's normalizers, `normalizeHook` for a producer that selects no lifecycle version and `enrichHook` for one that selects 1.1 or 1.2, map the lifecycle envelope to the 2.0 `lifecycle` observation as `packages/event-contracts/MAPPING.md` describes, and publish it as `org.bunny.lifecycle.observed` on `bunny.event.lifecycle.<session ID>`, whose subject is the session's entity ID, in one call to the runtime's SDK edge through `publishOnce`, with no stream. The mapping SHALL be the inverse of the core's: kebab-case event kinds, `eventId` as `nativeEventId`, known ordering with the identity's source as its authority, and every other field kept; a consumer's acknowledgment SHALL map to nothing. The script SHALL import only by package name, `@jimmie-potts/runtime/hook`, which SHALL load the normalizers, the SDK and the contracts and none of the rest of the runtime, so the installer can place it behind the hook link.

#### Scenario: Each accepted observation commits the session
- **WHEN** the hook runs a Claude Code session's `SessionStart`, `UserPromptSubmit` with a `prompt_id`, `PermissionRequest`, `PostToolUse` with a `tool_use_id` and `Stop` with an unchanged producer file that selects no lifecycle version, 1.1 or 1.2, against the runtime's gateway
- **THEN** each run exits 0 and writes nothing, the core accepts each observation from the producer's converted source, and each session appears, with its project from 1.1 on, holds the turn, raises the approval prompt on it, clears it and ends the turn idle with its notice

#### Scenario: A subagent
- **WHEN** the hook runs `SubagentStart` and `SubagentStop` for a subagent of a session the core holds, of a session it has not seen, and of a session its producer said is top-level, and a `SubagentStart` whose agent ID is its own session's
- **THEN** each subagent's record has the known parent in its own source and no project or host session ID, each parent counts it as active until its stop, a top-level parent stays top-level, and the hook drops the one that names its own session; an observation whose known parent is in another source or on another host, or is the child's own session, is refused at the edge with `invalid-message` and never reaches the core

#### Scenario: Each lifecycle version
- **WHEN** producers that select no version, 1.1 and 1.2 run the hook, with and without a receipt, in a Claude Desktop hook environment
- **THEN** each session reaches the core; the 1.1 and 1.2 sessions carry the project, and only the 1.2 sessions carry the host session ID

#### Scenario: Every 1.x event kind
- **WHEN** each lifecycle 1.x event kind is mapped with every optional field
- **THEN** each 2.0 observation follows profile 2.0 and its family, and the core's mapping turns it back into the same 1.2 envelope; an acknowledgment maps to nothing

### Requirement: The producer file, unchanged

The hook SHALL read the client's existing lifecycle 1.x producer file with the old hook's checks: opened without following a link, an owner-only regular file with one link of at most 8 KiB, holding exactly `enabled`, `endpoint`, `qualified`, `source` and `token` and an optional `lifecycleVersion` of `1.1` or `1.2`, enabled and qualified, with a token of 43 base64url characters and an endpoint `http://127.0.0.1:<port>/api/monitor/v1/events` without credentials, query or fragment. A `receipt.json` beside it, when there is one, SHALL be private, `installed` and match the producer's token, directory, endpoint, qualification, version and source. The hook SHALL use only the endpoint's host and port and the token, and SHALL publish as `bunny/parts/<ID>`, where the ID is `hub-` and the first 32 hex digits of the SHA-256 of the producer's source configuration without its hook name, as canonical JSON: the ID the Hub's setup gave the producer's credential, and the source `convertHubEdge` gives it. The hook SHALL never write the producer file or its receipt.

#### Scenario: A producer file the hook may not use
- **WHEN** the hook runs with no argument or two, or with a producer file that is missing, a link, a second hard link, readable by others, a directory, over 8 KiB, not JSON, with an unknown member, disabled, unqualified, with a token not in the Hub's form, an unknown lifecycle version, or an endpoint on another host, over https, on another path, with a query or with credentials, or beside a receipt that is still applying, holds another token, is readable by others, or names another source, endpoint, directory, lifecycle version, qualification or receipt version
- **THEN** each run exits 0 and writes nothing, nothing reaches the core, and the valid producer file beside them still works, as does a receipt that lists the source's members in another order

#### Scenario: The converted credential's source
- **WHEN** the source is derived for a producer configuration, and the Hub's credential of that ID is converted with `convertHubEdge`
- **THEN** the ID equals the Hub's `producerPrincipal` for that configuration whatever its hook name, and the converted credential acts as the derived source with no device widened

### Requirement: Bounded, quiet and fail-open hooks

Every path of the hook SHALL write nothing to stdout or stderr and exit 0, except one: a file read still under way at the deadline, which `process.exit` would wait for, SHALL end the process by `SIGKILL`. The hook SHALL make no permission decision, retry, device call or child process. A deadline 2.9 s from the process's start SHALL be armed before anything loads and SHALL end the process, inside the clients' 3 s hook timeout, whatever the runtime does; the publication SHALL get what is left of it. A hook whose work is done SHALL exit once no file read is under way. A check that cannot tell whether one is SHALL count as none, so the hook still exits 0. Input over 8 MiB, input that is not UTF-8 JSON, and a hook the normalizers do not map SHALL end the hook with nothing sent. A refused, revoked or unknown credential, a stopped runtime and a lost answer SHALL end it quietly too: the observation is lost, and nothing sends it again.

#### Scenario: A stopped runtime or a refused credential
- **WHEN** the hook runs against a port nothing listens on, or with a token the runtime does not hold
- **THEN** it exits 0 at once and writes nothing

#### Scenario: A runtime that never answers
- **WHEN** the hook runs against a listener that takes the call and never answers, or its client never closes stdin
- **THEN** it exits 0 on its own once its 2.9 s budget passes, within 3 s of its start, and writes nothing

#### Scenario: A file read stuck at the deadline
- **WHEN** a file read in the hook's process is stuck in an `open` that never returns, as a title read on a stalled mount is
- **THEN** the hook publishes its observation and ends by `SIGKILL` at its 2.9 s budget, within 3 s of its start, writing nothing; a FIFO as the transcript, which the title read opens without blocking, ends the hook at once with exit 0, and so does a process whose check for a pending read throws

#### Scenario: Input the normalizers do not map
- **WHEN** the hook gets no input, input that is not JSON or not an object, no hook name, a hook the normalizers do not map, no or a malformed session ID, input over 8 MiB or input that is not UTF-8
- **THEN** it exits 0, writes nothing and nothing reaches the core

### Requirement: The producer's grant

A producer's converted credential, with `ingest` alone, SHALL publish lifecycle observations and nothing else: a command, a subscription, a sync, a read on `/api/v2`, a publication on another key and another family's message on a lifecycle key SHALL each be refused with `forbidden` before anything reaches the bus. `GET /api/v2/authority?scope=ingest` SHALL answer 200 with the token, and every other scope `forbidden`, as an operator checks a producer added by hand until grant operations exist (owner decision, 2026-10-07).

#### Scenario: Outside the grant
- **WHEN** a producer's token requests `approval-recover`, subscribes, syncs, reads the sessions, publishes a lifecycle observation on a `turn-ended` key and publishes a `turn-ended` occurrence on a lifecycle key
- **THEN** each is refused with `forbidden`, the core receives nothing, and the same token's lifecycle observation on its own key is published

### Requirement: Trace and allowlist

Each observation SHALL start a new sampled trace, carried in the message and in the call's `traceparent` header, and the core's record of its intake SHALL carry that trace and the message's ID. Only what the normalizers' allowlist keeps SHALL leave the hook: no prompt, tool input, tool response or transcript, and the token only in the `authorization` header.

#### Scenario: The intake record carries the hook's trace
- **WHEN** a hook's observation is published
- **THEN** the core's `message.received` record with outcome `accepted` carries the observation's trace ID and message ID

#### Scenario: Dropped content
- **WHEN** a prompt, a tool's input and a tool's response carry a private canary
- **THEN** no log record, session record or message holds it, and none holds a token

### Requirement: Hook latency measured end to end

`apps/runtime/scripts/measure-hook.mjs` SHALL measure the hook from its start to its exit against a disposable runtime's edge: the shipped entry point with the core, its gateway and one converted producer credential, each hook a new Node process with an unchanged producer file and a synthetic payload. It SHALL report the median and the worst of at least 20 runs, check that the core accepted each, and measure a stopped runtime and one that never answers.

#### Scenario: The measurement
- **WHEN** the script runs 25 hooks through a session, 5 against a stopped runtime and 3 against one that never answers
- **THEN** it prints each run and a summary with the median and worst of each case and the count the core accepted, and removes its runtime and state
