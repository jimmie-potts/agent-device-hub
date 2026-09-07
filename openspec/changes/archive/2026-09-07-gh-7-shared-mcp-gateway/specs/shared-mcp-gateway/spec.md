## Purpose

Provide reusable authenticated local MCP access to registered device command owners, preserving controller contract semantics and source/installation evidence boundaries. The owning scope is [Hub #7](https://github.com/jimmie-potts/agent-device-hub/issues/7).

## ADDED Requirements

### Requirement: Embeddable opt-in protocol endpoint

The module SHALL export an opt-in Node Streamable HTTP handler with initialization, tool discovery and typed calls using a pinned supported MCP SDK and protocol version. It SHALL NOT create a listening server or install a service. It SHALL bound session allocation, require initialization for session traffic and associate each session with its authenticated principal.

#### Scenario: Disabled handler

- **WHEN** the owning application has not explicitly enabled MCP
- **THEN** the handler exposes no MCP initialization or tools and invokes no controller

#### Scenario: Authenticated initialization and discovery

- **WHEN** a valid machine principal initializes with a supported version and lists tools through its assigned session
- **THEN** the handler returns the qualified protocol version and schema-defined common tools with no agent/session or physical transport tools

#### Scenario: Session misuse or unsupported protocol

- **WHEN** a call lacks a required session, uses an expired session, belongs to another principal or requests an unsupported protocol
- **THEN** the handler returns the documented protocol/HTTP rejection before any controller operation

### Requirement: Explicit registration and device binding

The module SHALL register only server-configured controller and device IDs. It SHALL export common discovery, status, power and brightness tools and a default-device binding helper using the same validation and command path. Tool arguments SHALL NOT accept raw IPs, URLs, paths, credentials or protocol commands.

#### Scenario: Explicit registered device

- **WHEN** a caller selects an authorized registered device and invokes a typed operation
- **THEN** the module uses that registration's controller identity and owning service

#### Scenario: Bound device tool

- **WHEN** an embedding host binds a tool prefix to its configured default device
- **THEN** the tool omits target IDs from its arguments and uses the same registry, scopes, strict schemas and owning service as explicit targeting

#### Scenario: Invalid registrations and hostile arguments

- **WHEN** registration duplicates a device ID or references a missing default, or a call supplies an unregistered ID, unknown field, unsafe counter, fractional brightness or brightness outside 0 through 100
- **THEN** construction or the call fails before command dispatch

#### Scenario: Existing application extension

- **WHEN** an embedding application registers strict service extensions with a fixed device and its existing request identity or catalog result schema
- **THEN** the shared binding exports the configured local tool names, enforces current device/scope authorization and common transport bounds, and delegates to the existing app owner without requiring a fabricated API 1.0 service, receipt or command ledger

### Requirement: Authenticated bounded admission

The module SHALL validate machine credentials, Host and every supplied Origin before exposing discovery, state, cached results or controller calls. It SHALL enforce device and read/control scopes, explicit rotation/revocation and finite limits for bodies, authentication waits, outstanding operations, responses and sessions. Browser editing credentials SHALL NOT qualify as machine credentials.

#### Scenario: Native read principal

- **WHEN** a valid machine credential with read scope omits Origin and uses an allowed Host
- **THEN** it can discover and read only its permitted registered devices, and cannot invoke a control operation

#### Scenario: Invalid credential and browser protections

- **WHEN** a request has a missing, invalid, revoked or browser credential, or a disallowed Host, supplied Origin or Fetch-Metadata value
- **THEN** the module rejects it before session use, discovery, replay or controller work without exposing credentials in diagnostics

#### Scenario: Rotation and session isolation

- **WHEN** the verifier declares bounded credential overlap or revokes a credential after initialization
- **THEN** each subsequent HTTP request uses the current verifier result, undeclared/revoked credentials fail, and another principal cannot reuse the session

#### Scenario: Exhausted resources

- **WHEN** body, response, session, verification or outstanding-operation bounds are reached, including a verifier or controller that ignores abort
- **THEN** the module rejects additional work without allocating unbounded pending operations or dispatching another command, and releases occupied resources only when safe

### Requirement: One command admission owner

The module SHALL call the registered owning command service and SHALL NOT maintain a competing command queue, request ledger or physical writer. It SHALL preserve controller-issued request tickets, expected configuration revisions, expected generations, command values and authoritative receipts across browser, HTTP and MCP use.

#### Scenario: Concurrent clients

- **WHEN** a browser command and an MCP command race with the same controller-issued ticket
- **THEN** the owning service determines join, replay or conflict and at most one command is scheduled

#### Scenario: Duplicate, conflict and expired identity

- **WHEN** a caller repeats an identical request, changes a payload under the same identity or reuses an evicted/old-epoch identity
- **THEN** the module preserves the owner's replay/conflict/expiry result and never replaces the identity to obtain a new execution

#### Scenario: Revision and capability changes

- **WHEN** configuration, generation or capability support changes after the caller read status
- **THEN** the module preserves the owner's revision-conflict, stale-generation or unsupported-capability result without attempting a fallback operation

### Requirement: Evidence-preserving tool results

The module SHALL validate controller output and return schema-valid structured content with matching JSON text. It SHALL preserve desired, pending, transmission, observation and uncertainty fields separately. Tool annotations SHALL distinguish reads from writes accurately and SHALL NOT imply permissions, telemetry certainty, optical verification or agent task success.

#### Scenario: Unknown observation and queued command

- **WHEN** a ready controller reports unknown observation or accepts a queued command
- **THEN** status remains observationally unknown and the command result remains queued rather than reporting confirmed visible device state

#### Scenario: Partial, uncertain or cancelled result

- **WHEN** the owner returns partially-applied, uncertain or cancelled with priorEffects and operation lists
- **THEN** the tool returns the unchanged authoritative receipt, marks it as a tool error and does not erase prior effects

#### Scenario: Adapter failure after dispatch

- **WHEN** a controller adapter times out, throws or returns an invalid response after command dispatch and no authoritative receipt is available
- **THEN** the module reports possible effects with the original request identity, invents no receipt revisions and performs no automatic retry

### Requirement: Client lifetime does not own backend execution

The module SHALL respect explicit MCP cancellation before dispatch while leaving admitted work and generation cancellation with the controller. Socket closure, session deletion/expiry, revoked access and module shutdown SHALL NOT stop playback, restore old state or resend an ambiguous write.

#### Scenario: Cancellation before dispatch

- **WHEN** an explicit cancellation reaches the handler before command dispatch
- **THEN** the module schedules no controller command

#### Scenario: Disconnect after admission

- **WHEN** a client disconnects or deletes its MCP session after the service admits a command
- **THEN** the owning backend continues its work independently, no second command is issued, and a later snapshot or exact-identity request can report the owner's retained result

#### Scenario: Controller generation cancellation

- **WHEN** the controller retires a generation before dequeue or after an operation was sent
- **THEN** MCP preserves the owner's cancellation outcome and any confirmed or possible prior effects

### Requirement: Portable private module and qualified fixtures

The module SHALL ship a versioned private npm archive with immutable source provenance, SHA-256, file manifest, SDK/license record and the pinned private controller-contract dependency. It SHALL be consumable without sibling-checkout imports or newly provisioned cross-repository CI secrets. Codex and Claude protocol fixtures SHALL use fake services and synthetic credentials, and installed-client/physical acceptance SHALL remain explicitly separate.

#### Scenario: Isolated consumer installation

- **WHEN** a consumer installs the verified archive outside the hub checkout with no access to private package registries or sibling repositories
- **THEN** package imports and the protocol fixture suite succeed using the bundled contract artifact and pinned public dependencies

#### Scenario: Corrupt or incompatible artifact

- **WHEN** an archive hash, shipped-file hash or supported contract version differs from the recorded value
- **THEN** the consumer verification rejects it before tool construction or command execution

#### Scenario: Protocol client matrix

- **WHEN** Codex-style bearer and Claude-style header fixtures initialize, discover and call tools at each qualified protocol version
- **THEN** common success, authorization, replay, cancellation and failure cases pass, while the evidence record states that no installed client, personal configuration or hardware was exercised
