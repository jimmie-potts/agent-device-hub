# runtime-agent-hooks Specification

## Purpose
Define the 2.0 agent hook under ADR 0012 (Hub #926): the script that Claude Code's and Codex's hook commands run, which reads an unchanged lifecycle 1.x producer file and publishes one lifecycle observation to the runtime's SDK edge as the producer's converted credential, within the old hook's bounds and fail-open behavior, with its grant, trace, allowlist and measured latency. It is source; the cutover (#840) installs it.

## Requirements

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

Every path of the hook SHALL write nothing to stdout or stderr and exit 0, except unfinished native filesystem or DNS work at the deadline, which `process.exit` would wait for: the hook SHALL then end itself by `SIGKILL`. The hook SHALL make no permission decision, retry, device call or child process. A deadline 2.9 s from the process's start SHALL be armed before anything loads and SHALL end the process, inside the clients' 3 s hook timeout, whatever the runtime does; the publication SHALL get what is left of it. A hook whose work is done SHALL exit once no native filesystem or DNS worker remains. A check that cannot tell whether one remains SHALL count as none, so the hook still exits 0. Input over 8 MiB, input that is not UTF-8 JSON, and a hook the normalizers do not map SHALL end the hook with nothing sent. A refused, revoked or unknown credential, a stopped runtime and a lost answer SHALL end it quietly too: the observation is lost, and nothing sends it again.

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

#### Scenario: Native DNS remains blocked
- **WHEN** either hook entrypoint starts a native hostname lookup that cannot finish within the hook budget
- **THEN** its own hard deadline ends it silently by signal within the existing client timeout without waiting for the resolver; no HTTP observation has been sent, and an independent controller does not enforce the deadline


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

### Requirement: Metadata-only local Codex hook
The local Mac Codex wrapper SHALL reuse the existing bounded SDK hook for SessionStart except compact, UserPromptSubmit, Stop, Interrupt and SessionEnd. It SHALL discard any input with an own agent_id property and forward only hook_event_name, session_id and optional turn_id. It SHALL never open supplied paths, enrich from local indexes, retain or publish raw private fields, change notify, decide permissions or command devices. A metadata-only producer check SHALL refuse lifecycle enrichment before consuming input. Delivery SHALL remain silent and fail open under the existing deadline without retries.

#### Scenario: Private or child input
- **WHEN** a hook includes prompt, reply, cwd, transcript path or agent_id
- **THEN** private fields are discarded without path reads, and a child input produces no parent observation

#### Scenario: Misconfigured enriched producer
- **WHEN** the wrapper selects a producer with lifecycleVersion configured
- **THEN** it refuses before reading hook input or attempting network/file enrichment

#### Scenario: Installed local coverage
- **WHEN** the approved local Desktop and native CLI each run a controlled ordinary session
- **THEN** observed events reach the dashboard under the shared local identity, with supported gaps stated explicitly and existing notify preserved

#### Scenario: Cloud orchestration or unavailable hub
- **WHEN** orchestration cannot emit local hooks or the hub is unavailable
- **THEN** no coverage is claimed for that path and the hook returns silently without blocking agent work

### Requirement: Explicit qualified private HTTPS producer

The runtime hook SHALL accept the existing producer format with an additional
`transport: "private-https"` only for an HTTPS endpoint whose path is
`/api/monitor/v1/events`, without URL credentials, query or fragment. It SHALL
use that endpoint's origin with the existing SDK publication path. A remote
producer SHALL require a private installed version-1 receipt whose token,
directory, endpoint, qualification, lifecycle version, source configuration and
`input.transport` match. An absent transport SHALL retain the existing local
loopback rule and optional-receipt compatibility. A URL change alone SHALL NOT
inherit local qualification. All existing file, size, permission, normalizer,
metadata-only wrapper, trace, no-retry and 2.9-second fail-open rules SHALL remain.

#### Scenario: Explicit remote qualification
- **WHEN** a private enabled qualified HTTPS producer selects `private-https` with its matching installed receipt
- **THEN** its one observation is published through verified HTTPS as its granted source

#### Scenario: Missing or changed remote receipt
- **WHEN** the remote receipt is absent, applying, unsafe, or names a different transport, token, directory, endpoint, lifecycle version or source
- **THEN** the hook sends nothing and remains silent and fail open

#### Scenario: Old local qualification
- **WHEN** an existing local producer has no transport member, with or without its matching receipt, or its URL alone is changed to HTTPS
- **THEN** the local producer still works and the URL-only change emits nothing

#### Scenario: Host loss or half-open route
- **WHEN** credentials are missing or revoked, DNS/TLS is unavailable, a host sleeps, or an HTTPS peer takes a publication without answering
- **THEN** the hook ends within its existing budget, queues and retries nothing, and missing observations establish neither connectivity nor completion

### Requirement: Native producer setup and endpoint switching

The setup procedure SHALL identify the actual execution host and supported
Codex or Claude client path, reuse stable provider/client/host/source identity
and grant each selected producer only its own ingest source. It SHALL document
native startup/sign-in, private credential provisioning, receipt qualification,
manual pause/revocation and explicit endpoint switching separately from the core
container lifecycle. It SHALL preserve notify and unrelated settings and hooks.
Actual client qualification SHALL remain separate from source and disposable
TLS tests. An iPhone-driven session SHALL use its actual supported execution
host; a phone UI SHALL NOT establish local hook coverage for cloud-only work.

#### Scenario: Four selected feeds
- **WHEN** normalizer-produced Codex and Claude observations on two hosts use the same session identifier
- **THEN** four independent records retain their own activity, attention and notices, while duplicates or rejected observations add no owner or mixed state

#### Scenario: Endpoint switch
- **WHEN** the operator selects a new qualified core endpoint
- **THEN** the producer stays disabled until its endpoint, private grant and matching installed receipt are verified, with no queue, fallback credential or automatic replay

### Requirement: Claude terminal offers an explicit bound read action

The qualified Claude terminal extension SHALL offer an explicit action for a successful completed root result. It SHALL correlate the native extension turn with the classic lifecycle prompt ID, preserve the native session identity, and discard an incomplete or inconsistent mapping. It SHALL freeze the selected target when the pane opens and retain it if another result completes. Opening, rendering, completion and headless execution SHALL emit no positive receipt.

The extension SHALL use a bounded host helper with the selected private producer file. The helper SHALL use existing SDK sync and publication, with no state polling, automatic retry or device wait. It SHALL bind only the matching finished lifecycle turn and publish only allowlisted lifecycle/2.1 metadata. It SHALL distinguish confirmed state from a sent but unconfirmed observation. Unsupported native versions or UI kinds SHALL remain unavailable.

#### Scenario: Native prompt and turn IDs differ
- **WHEN** the extension observes a root prompt, its native turn start, its matching classic Stop and successful turn completion
- **THEN** its action identifies the lifecycle prompt that the existing hook sent, even when the extension turn ID differs

#### Scenario: Old pane after a new result
- **WHEN** result B completes while the pane for A remains open and the user clicks A
- **THEN** the action retains A's mapped identity and frozen owner target

#### Scenario: No action or incomplete mapping
- **WHEN** a pane renders without a click, the client is headless, the turn is a child, interrupted or failed, the prompt mapping is missing, or the session is cleared
- **THEN** no positive read observation is published

#### Scenario: Unavailable helper
- **WHEN** configuration is unsafe, the endpoint refuses access, the owner has no matching finished record, or the helper reaches its deadline
- **THEN** agent behavior and permission decisions are preserved, no retry starts, and no successful read is claimed

#### Scenario: Private fields
- **WHEN** native hook inputs contain prompt, response, transcript path, tool content or credentials
- **THEN** none of those fields enters the helper input, lifecycle message, session provenance or diagnostic output

### Requirement: Qualified Codex Desktop read actions preserve the native target

An explicitly enrolled, version-qualified Codex Desktop observer SHALL correlate the actual client's native read request and successful response on the same controlled connection. It SHALL require an observed unread revision and the matching latest completed native turn before the request. It SHALL bind the existing lifecycle session's full identity, generation, known turn and finished notice at that request, and SHALL never bind a delayed response to a later owner target. It SHALL preserve `codex/local` identity and emit only the existing provider-client lifecycle/2.1 receipt.

The observer SHALL NOT issue native read updates, infer a read from shared notifications or absent markers, capture prompt/reply/transcript content, or publish title/archive evidence. It SHALL require a distinct qualified source credential and use the existing SDK sync/event stream. It SHALL leave native protocol bytes and permission decisions unchanged. Bounds, expired correlation, malformed traffic, lost owner freshness, unsupported versions and observation errors SHALL suppress affected receipts while native traffic continues. Reconnection SHALL discard pending actions and require fresh evidence; no offline read action SHALL replay automatically.

#### Scenario: Open one completed thread
- **WHEN** the qualified Desktop opens completed thread A and its native read request succeeds while thread B remains unopened
- **THEN** only A's frozen completed owner target receives a receipt
- **AND** B's read state remains unchanged

#### Scenario: Native action is not established
- **WHEN** a snapshot or notification arrives without the matching Desktop request, the request fails, the latest completed turn is unknown, or an explicit unread action occurs
- **THEN** no positive receipt is produced from that evidence

#### Scenario: A newer turn or connection replaces the observed target
- **WHEN** a newer turn begins, pending correlation expires, or the native/owner connection loses freshness before publication
- **THEN** the pending action is discarded and cannot be rebound after recovery

#### Scenario: Observer is unavailable
- **WHEN** enrollment is absent or unsafe, a version is unsupported, parsing exceeds its bounds, or the receipt endpoint fails
- **THEN** native input and output continue unchanged without waiting for B.U.N.N.Y. or a device
- **AND** the observer makes no successful-read claim

#### Scenario: Native exit while collection is stalled
- **WHEN** the native app-server exits while a collector filesystem or DNS operation remains blocked
- **THEN** the observer forwards the completed native output and ends within its bounded shutdown period without waiting for that operation
- **AND** it uses `SIGKILL` if native work does not settle; an ordinary exit retains the native exit code

#### Scenario: Explicit installation
- **WHEN** the operator selects the qualified Desktop launcher and dedicated producer configuration
- **THEN** observation belongs only to that controlled native connection and provider feed
- **AND** personal hooks, agent permissions and unrelated running clients are unchanged
