## MODIFIED Requirements

### Requirement: Module manifest checks

The SDK SHALL export `checkModuleName`, `checkApiVersion`, `checkContributions` and `checkManifest`, which return the runtime's own reason for refusing a module, as a code from the 2.0 error registry and a fixed sentence, or undefined when the runtime would accept it. `MODULE_API_VERSION` SHALL be `1.2`: `1.1` added the module's configuration, secrets, private folder and worker calls to `1.0`, and `1.2` adds its contributions to the runtime's gateway (Hub #835); a `1.0` or `1.1` module SHALL still be accepted.

A manifest MAY declare `pages` (at most 16, each `{id, title, render}`, with distinct IDs of lowercase letters and digits with single hyphens of at most 64 characters, never `content`, and titles of at most 80 characters), `content(ref)` (content by reference, `{type, bytes}` or undefined), `tools` (at most 16 read tools, each `{name, description, input, output, read}`, with distinct names of a lowercase letter then lowercase letters, digits and underscores of at most 48 characters, descriptions of at most 1024 characters, an object `input` schema that allows no other member and an object `output` schema) and `settings` (`{schema, show}`, an object schema and what to show of the configuration `configure` accepted, so a module that declares settings SHALL declare `configure`, keeping one configuration path). `checkContributions` SHALL refuse each malformed one with `invalid-request`, and SHALL refuse any of them in a manifest written for a module API older than `1.2`. `checkManifest` SHALL include it.

The manifest MAY declare a synchronous `configure(section)` that returns `{config, devices?}` or a refusal from `errorBody`, whose detail SHALL be fixed text that repeats no value from the section, since health shows it. A module's context SHALL type its configuration as possibly undefined, because `configure` is optional. `checkConfiguration(manifest, section)` SHALL check a module's own section of the runtime's configuration file as the runtime does before it starts the module, and SHALL return `{status: 'accepted', config, devices, secrets}` or `{status: 'refused', problem}`: a module that declares `configure` needs a section (`not-found`); a section is a JSON object (`invalid-request`); its `secrets` member, when present, maps at most 16 names, each lowercase letters and digits with single hyphens, to absolute paths (`invalid-request`); `configure` must not refuse, with the refusal's code and detail, throw (`internal`, keeping what it threw in memory only) or answer neither a configuration nor a valid refusal (`internal`); and its devices must be distinct routing IDs of at most 128 characters (`invalid-request`). A module without `configure` SHALL get an undefined configuration and the secrets its section names. The runtime and the module test kit SHALL both use them.

#### Scenario: The kit and the runtime refuse the same manifests
- **WHEN** a module declares API version `2.0` to a runtime that supports `1.0`
- **THEN** `checkManifest` returns `unsupported-version`, the runtime refuses the module, and the kit's manifest check fails

#### Scenario: The kit and the runtime check the same configuration
- **WHEN** `checkConfiguration` gets no section for a module with `configure`, an array, malformed secrets, a refusing or throwing `configure`, devices that are not distinct routing IDs, and a valid section
- **THEN** it refuses them with `not-found`, `invalid-request`, `invalid-request`, the refusal's code or `internal`, and `invalid-request`, and accepts the valid one with its configuration, devices and secrets; the runtime refuses and the kit's manifest check fails for the same sections

#### Scenario: Contributions checked like the rest of the manifest
- **WHEN** `checkManifest` checks a `1.2` module with a page, content, a tool and settings, the same contributions declared by `1.0` and `1.1` modules, pages with malformed, repeated or reserved IDs, a missing title or render, tools with malformed or repeated names, an input that allows other members, a non-object output or no read, and settings without `configure`, schema or show
- **THEN** it accepts the `1.2` module and a `1.3` one, refuses the older ones with `pages, content, tools and settings need module API 1.2` while each still runs without contributions, and refuses every malformed contribution with `invalid-request` and a fixed sentence naming it

## ADDED Requirements

### Requirement: Edge grants by calls and routing keys

A `RemoteEdge` grant MAY list the `calls` it may make and the routing-key patterns, `keys`, it may use; either left out SHALL allow all. A key a part publishes or requests SHALL match one of its patterns, and a pattern it subscribes or responds to, and the state keys `bunny.state.<family>.*` of each family it syncs or serves, SHALL lie within one; `reply` SHALL come with `respond` and `answer` with `serve`, and every part MAY open its stream and close what it opened on it. A grant MAY also list `publishes`, the payload families, by the family of a message's `dataschema`, that it may publish, and `excluded`, key patterns it may never use or receive though `keys` covers them: a key it publishes or requests, or a pattern it responds to, that meets an exclusion SHALL be `forbidden`; a subscription SHALL never queue a message whose key an exclusion matches; and a sync answer SHALL leave out every record, and every member of its membership, whose state key an exclusion matches, with the owner's revision unchanged. Anything else SHALL be refused with `forbidden` before it reaches the bus, recorded as an `edge.refused` warning with the part's source. The edge SHALL refuse at start a grant whose calls are not its own, whose patterns or exclusions it cannot read or whose families are malformed, without naming the token. A host MAY authenticate calls itself with `authenticate(request)`, which returns the principal a call acts as, `{source, id?, calls?, keys?, publishes?, excluded?}`, or undefined for `unauthenticated`, and `disconnectPrincipal(id)` SHALL end the streams a principal opened. The client SHALL name its source in every call's `bunny-source` header, and the edge SHALL refuse a token used under another source with `forbidden` at connect. A refusal's detail SHALL be fixed text that quotes nothing the caller sent, such as a key, a path, an ID or a source, and every answer of the edge SHALL carry `x-content-type-options: nosniff`.

#### Scenario: A grant's calls and keys
- **WHEN** a part granted only `publish` on `bunny.event.test-turn.*` publishes there and elsewhere, requests, subscribes and syncs; a reader granted `subscribe` and `sync` on every state and event key syncs, publishes, responds and serves; and a panel granted `request` on one device and `subscribe` on one family commands that device and another, subscribes within and beyond its pattern, and syncs
- **THEN** only the hook's own publish, the reader's sync, the panel's own command and its narrow subscription go through; everything else is `forbidden` and never reaches the bus, a raw sync request without `sync` included

#### Scenario: Another declared source
- **WHEN** a part connects with another source's token, or posts a call naming another source
- **THEN** both are `forbidden` and no stream opens, while the token's own source connects

#### Scenario: The families a part may publish
- **WHEN** a part granted `publish` on every event key but only the `test-turn` family publishes an outcome on an event key, and its own observation
- **THEN** the outcome is `forbidden` and no subscriber hears it, and the observation goes through

#### Scenario: Exclusions narrow what a part receives
- **WHEN** a reader whose grant excludes `bunny.*.*.s2` syncs a family whose owner holds `s1` and `s2`, subscribes to it while the owner changes both, and requests a command for `s2` and for `s1`
- **THEN** its copy and the answer's membership hold `s1` alone, its subscription hears `s1`'s change alone with its key, nothing for it was queued or dropped, the command for `s2` is `forbidden` and the one for `s1` is accepted

#### Scenario: Refusals quote nothing the caller sent
- **WHEN** a part calls a route the edge does not have, a key outside its grant and a command from another source, each naming a marker
- **THEN** each answer is the shared error body without the marker or the other source, with `nosniff`

### Requirement: Commands are never sent twice through an edge

The edge SHALL remember each command it hands its bus, by the sender's source and the message ID, and SHALL refuse the same message again with `duplicate-conflict` before anything happens, whether or not the first one has settled, so a raw HTTP client cannot make a responder run a command twice. It SHALL remember a command while its bus has it, and once settled until its `expiresat`, at most `REMEMBER_MS`, 10 minutes. A command refused before it reached the bus, or one the bus refused with no reply, before any responder had it, SHALL be forgotten, since sending it again is safe. One source SHALL have at most `MAX_REMEMBERED_PER_SOURCE`, 1,024, remembered at once, and all sources `MAX_REMEMBERED_COMMANDS`, 65,536; past either, that source's next command SHALL be refused with the retryable `capacity`, settled entries whose time has passed being forgotten first, and another source's SHALL still go through. A new edge, as after a restart, SHALL remember none.

#### Scenario: A command repeated after its first forward settled
- **WHEN** a raw client sends a command that the responder accepts, then the same message again, then a new message with the same request ID
- **THEN** the repeat answers 409 with `duplicate-conflict` and an `edge.refused` warning, the new message goes through, and the responder ran the first command once

#### Scenario: A command repeated while its first forward waits
- **WHEN** a raw client sends a command a remote responder holds, its stream drops and the responder registers again, and the client sends the same message again
- **THEN** the repeat is refused with `duplicate-conflict` and the responder saw the command once

#### Scenario: A refusal is not remembered
- **WHEN** a command is refused for a key outside the grant, then sent with a key inside it
- **THEN** the second is accepted

#### Scenario: One source's quota
- **WHEN** one source's quota is two and it sends three commands, and another source sends one
- **THEN** its third is refused with `capacity`, retryable, and the other source's goes through

#### Scenario: Forgotten when refused, bounded once settled
- **WHEN** a command with a minute to its expiry goes to a key nobody responds to, then again once a responder registers, again, and again 999 ms and 1,000 ms after it settled, with `rememberMs` 1,000
- **THEN** the answers are `unavailable`, accepted, `duplicate-conflict`, `duplicate-conflict` and accepted, and the responder ran it twice

### Requirement: Commands bound to their key's entity

By ADR 0012's routing-ID rule an entity's ID is the last token of its routing keys, so a command's `subject`, the entity it is for, SHALL be its key's last token. The bus SHALL refuse any other command, on every transport, from `request` and from a remote edge's `requestMessage`, with `invalid-message` before a responder has it, so a grant of a key covers exactly the entity a responder acts on. A remote edge SHALL refuse with `invalid-message` a message a remote part publishes whose subject is not its key's last token; a malformed key SHALL still be the bus's `invalid-request`. A handler SHALL receive each message with the routing key it was published on, on every transport, and `subscribe` SHALL take `accept(key)`, which keeps only the messages whose key it accepts: one it declines is never queued, so it is neither delivered nor counted as dropped. The bus's own refusals SHALL quote no key, pattern or source.

#### Scenario: A command for another entity than its key's
- **WHEN** a participant in process, a raw client and the SDK's client each send, on a key their grant covers, a command whose subject names another entity, and then one for the key's own
- **THEN** each misrouted one is `invalid-message`, nothing reaches a queue or a responder, and the last is accepted

#### Scenario: A remote publish for another entity
- **WHEN** a remote part publishes an observation on `bunny.event.test-turn.s1` whose subject is `s2`
- **THEN** it is refused with `invalid-message` and no subscriber hears it

### Requirement: Stream liveness

The edge SHALL write a heartbeat comment line on each stream every 15 s (`HEARTBEAT_MS`) and SHALL end a stream whose socket stays full for 30 s (`STALL_MS`), its reader having stopped, so its subscriptions close and free their queued messages; it SHALL report that end as an `edge.disconnected` warning with `capacity`. The client SHALL take a stream that delivers nothing, heartbeats included, for 45 s (`IDLE_MS`) as lost, reconnect and tell its subscriptions of the gap, so its copies sync again with nothing replayed. These timers SHALL run on a `liveness` scheduler that defaults to real timers that keep no process alive, whatever the deadline scheduler is.

#### Scenario: Heartbeats
- **WHEN** a stream stays open with nothing to send
- **THEN** it gets a heartbeat at each interval and none before

#### Scenario: A stalled reader
- **WHEN** a reader subscribes and stops reading, the publisher fills its socket and its queue, and the stall limit passes
- **THEN** a full socket alone ends nothing, the limit ends the stream with an `edge.disconnected` warning with `capacity`, and a later publish queues nothing for the reader

#### Scenario: A silent stream
- **WHEN** the edge sends no heartbeat and the client's idle limit passes while it holds a synced copy
- **THEN** the client reports the lost stream, reconnects, and the copy syncs again at the owner's new revision
