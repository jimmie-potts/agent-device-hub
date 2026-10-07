# Shared event contracts

Private source package `@jimmie-potts/event-contracts` 1.0.0 defines the
[B.U.N.N.Y. CloudEvents profile](../../docs/event-contract.md). No runtime
producer/transport is enabled. Existing lifecycle and controller formats remain
unchanged; consumers must select an explicit adapter before adopting this profile.

The package also holds profile 2.0, the single message format that
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md) requires after the
cutover. See [Profile 2.0](#profile-20). Profile 1.0 below stays unchanged until
the retirement story removes it.

- `schemas/event-v1.schema.json`: closed Draft 2020-12 profile, registry bindings
  and typed payload definitions. Schema identifiers are resolved locally.
- `src/index.ts`: TypeScript types, bounded `validateEvent(unknown)` and pure
  `referenceDecision(unknown)`; build emits `dist/`.
- `python/event_contracts`: Python `validate_event` / `reference_decision` with
  the same rules and schema. Keep this directory beside `schemas/`.
- `fixtures/events-v1.json`: language-neutral validation and reference cases;
  both runners assert every case's expected result and immutable input.

Run `npm run test:events` and `npm run test:events:python` from the repository
root using Node 24 and Python 3.14. The Python runner uses the repository's
`requirements-contracts.txt`. Shared build/type/workflow and compatibility checks
are documented in [development](../../docs/development.md#shared-event-contract-checks).

Validation returns `{ok:true,value}` with detached data or
`{ok:false,code:"invalid-event"}`. It applies JSON structure/ASCII and byte limits,
then schema shape and calendar, occurrence, reference and validity-window rules.
Callers must enforce transport bytes before parsing. It does not authenticate a
source, verify a claimed durable commit or detect a secret encoded as a permitted
neutral ID. Do not hand in executable objects such as proxies.

`referenceDecision` accepts one of two closed example inputs:

- `{operation:"retry",event,prior}`: `prior` is null or the retained event with
  which to compare identity. Returns `new`, `duplicate`, `conflict` or `invalid`.
  The caller owns retention and lookup; this function creates no cache.
- `{operation:"delivery",event,recovery,nowMs,acceptance,handling,delivered}`:
  booleans mark historical recovery and delivery acknowledgment; `nowMs` is a
  nonnegative safe integer; acceptance is `unconfirmed`, `confirmed`, `failed`
  or `ambiguous`; handling is `pending`, `handled` or `expired`. Outputs are
  the reference actions shown in the shared corpus. Input has the same structural
  bounds as validation. Confirmed acceptance and explicit expiry are supplied
  evidence, not facts derived from this envelope or function.

`eligible-live-effect` means only that this reference window/recovery check
passes. A real evaluator still needs authorized policy, fresh state, mode and
generation checks and the designated controller queue. `read-snapshot` is a
reconciliation instruction, not a stored snapshot or complete history. Notification
results express an obligation under a future selected policy, not an implemented
store, queue, automatic retry or human acknowledgment.

No separate repository may depend on a mutable checkout path. Before external
adoption, publish a versioned private artifact with an immutable source receipt
and checksum and run that consumer's contract tests. This source package is not
a public registry release and is not installed by source delivery.

## Profile 2.0

Import it as `@jimmie-potts/event-contracts/v2`. It is TypeScript only and
follows the strict profile for new code.

- `schemas/v2/envelope.schema.json`: the envelope every message uses. It has
  a required `subject` and `traceparent`, an absolute `dataschema` URI and a
  `kind`. It defines no `tracestate` or baggage, so a message that carries
  `tracestate` is refused like any other undeclared attribute. Commands and
  sync requests require `expiresat`; no other kind may carry it. The `type`
  suffix must match the kind, for example
  `org.bunny.<entity>.<verb>.requested` for a command. Only sync messages may use
  `org.bunny.sync.requested` and `org.bunny.sync.completed`. A sync request's
  `subject` names its requested families joined by commas, such as
  `session,inbox-item`, and its `sync.completed` carries the same subject; the
  validator does not check this.
- `schemas/v2/blocks.schema.json`: building blocks for payloads. These are
  identifiers, routing IDs (identifiers that are also routing-key tokens:
  lowercase letters and digits with single hyphens, Hub #918), `<name>AtMs`
  instants, revisions, the `{epoch, sequence}` ticket, ordering, tagged unknown
  values, kebab-case enum values, entity references and the error body.
- `schemas/v2/kinds.schema.json`: payloads the profile owns for replies,
  completed outcomes, removals, sync requests and `sync.completed`. An outcome
  is `succeeded`, `failed` or `uncertain`, with evidence `transmitted`,
  `observed` or `none`. `none` means there is no evidence that anything reached
  the device, as after a failure before sending or a lost answer. A succeeded
  outcome always has `transmitted` or `observed` evidence, and a failed one
  carries an error. For an effect on state the owner keeps itself, such as a
  setting or a playlist, the owner's committed state, published with the
  outcome, is the observation, so the outcome is `observed`.
- `schemas/v2/errors.json`: the error code registry. Each code says whether a
  retry can help. The error block in `blocks.schema.json` lists the same codes
  and flags, so a received error body with another code or flag is refused; a
  test keeps the two files equal.
- `src/v2/index.ts`:
  - `MessageValidator`. `register(dataschema, schema, check?)` adds a module's
    payload schema under `https://bunny.invalid/events/<family>/<major>.<minor>`;
    it refuses reserved families and duplicates. The optional `check` states a
    rule the schema cannot, such as two fields that must agree; it runs after
    the schema passes and returns where the message breaks it. A check that
    throws or returns an empty or non-string answer still refuses the message
    with `invalid-message`, and validation never throws. `validate(input, {nowMs})`
    returns `{ok:true,value}` or `{ok:false,error}`, where `error` is the
    registry's error detail.
  - `ErrorCode`, the registry's codes as a literal type, and `RETRYABLE`, each
    code's fixed `retryable` flag, from `src/v2/errors.ts`. A test keeps that
    table equal to `errors.json`, code for code and flag for flag. A code
    outside the registry fails to compile wherever an `ErrorCode` is expected,
    such as `errorBody`'s first argument or `ErrorDetail.code`.
    `isErrorCode(value)` checks a code read from data that has not been
    validated.
  - `errorBody(code, extra)`, which builds `{"error":{...}}`, takes
    `retryable` from the registry and throws on extras the error block would
    refuse, and on an unregistered code from an untyped caller.
  - `compareDelivery(prior, next)`, which classifies a retry under the
    identity `(source, id)` as `new`, `duplicate` or `conflict`. It compares
    every attribute and the payload, ignoring key order, so an outbox resends
    the exact message it stored rather than rebuilding it.

Validation refuses a message with:
- `too-large`, when it is over 256 KiB;
- `invalid-message`, when it is not a plain JSON object, breaks the envelope or
  payload schema or a registered check, has an all-zero trace context, names an
  impossible date or uses the wrong built-in schema for its kind;
- `unsupported-version`, for another `bunnyprofile` or an unregistered version
  of a registered family;
- `unknown-schema`, for an unregistered family;
- `expired`, when a command or sync request is past `expiresat` and the caller
  passed `nowMs`.

Where the check failed is named in `detail`, for example
`envelope /time pattern`.

Module payload schemas reference the blocks by URI, for example
`{"$ref": "https://bunny.invalid/events/blocks/2.0#/$defs/ticket"}`.
`fixtures/v2/messages.json` shows three example families and one valid message
for each kind. Each invalid case patches a valid message and states the
expected code. `tests/v2.test.mjs` runs the fixtures, plus the size, expiry,
retry identity, registration and error-registry cases. `npm run test:events`
runs it, the core family, device family, status and mapping tests, and the 1.0
tests.

### Core payload families

The core families are the facts every module can rely on, and the commands that
change them ([Hub #842](https://github.com/jimmie-potts/agent-device-hub/issues/842),
[#918](https://github.com/jimmie-potts/agent-device-hub/issues/918)).
Import them from `@jimmie-potts/event-contracts/v2/families`. Each schema lives
in `schemas/v2/families/<family>.schema.json`, is built from the shared blocks
and is registered under `https://bunny.invalid/events/<family>/2.0`. No family
carries a device-specific payload: modules define those.

| Kind | Family | Type |
| --- | --- | --- |
| state | `session`, `mode`, `inbox-item`, `playback` | `org.bunny.<family>.updated` |
| occurrence | `lifecycle` (a hook observation for the core) | `org.bunny.lifecycle.observed` |
| occurrence | `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` | `org.bunny.attention.raised`, `.attention.cleared`, `.turn.ended`, `.session.ended` |
| occurrence | `moment-ended` | `org.bunny.moment.ended` |
| command | `mode-set`, `moment-play` | `org.bunny.mode.set.requested`, `org.bunny.moment.play.requested` |
| command | `notice-acknowledge`, `playback-control` | `org.bunny.notice.acknowledge.requested`, `org.bunny.playback.control.requested` |
| command | `approval-recover` | `org.bunny.approval.recover.requested` |

The rules:
- A state event carries the full record of one entity, and its `subject` is the
  entity's `id`.
- A session's `id` is `sessionEntityId(identity)`, the lowercase hex SHA-256 of
  the identity as compact sorted-key UTF-8 JSON.
- Agent occurrences name the session, its identity, the observation's turn and
  evidence, and the owner revision that committed them. An attention occurrence
  also carries the item's own turn, which a clearing observation's turn may have
  left behind.
- The owner publishes a new revision when a session's freshness or the playback
  availability changes.
- Commands name no device: the envelope `subject` names the target. Their
  replies and outcomes use the profile's reply and outcome payloads.
- `approval-recover` (Hub #835) is the old Hub's operator recovery, carried as
  a command to the core: `{requestId, turnId, expectedRevision}`, with the
  session's `id` as its `subject` and the session record's `revision` that the
  operator read as `expectedRevision`. The core retires the one approval marker
  without an attention ID that the session holds on `turnId`, only while the
  session's evidence is uncertain, and publishes `attention-cleared` with cause
  `recovered`. It approves or denies nothing at the agent.
- `notice-acknowledge` is how a consumer, such as the Pixoo module after a
  dismissal, acknowledges one turn-ended notice for its own consumer ID. Its
  `subject` is the session's `id`, and the core (#831) adds the consumer to the
  notice's `acknowledgedBy`. Acknowledgments are recorded per consumer, and each
  consumer's policy decides which acknowledgments clear what it shows, as today:
  LIFX and Tidbyt clear a finished turn on any consumer's acknowledgment (ADR
  0012, "Inbox and history"). It replaces the 1.x `notice.acknowledged`
  observation, so the `lifecycle` family refuses that event. An acknowledgment
  proves neither readership nor a cleared attention item. A consumer
  acknowledges for itself only: the core refuses one whose source does not end
  in its consumer ID with `forbidden`. It commits the acknowledgment before it
  replies `accepted`, and no outcome follows ([MAPPING.md](MAPPING.md)).
- `playback-control` asks the owner of the `playback` record (#929) for play,
  pause, next or previous. The owner sends it once, to the source presented at
  admission, and never redirects or retries it. The record's `id`, and so the
  command's `subject`, is a routing ID.
- A `moment-play` request's `subject` is the target device's ID.
- A removal event, with reason `expired`, `retired` or `deleted`, drops an
  entity. A sync replaces the consumer's membership of the synced families.

`registerCoreFamilies(validator)` registers every family. A family's messages
must use its kind and type. `MessageValidator.register` takes an optional check
for rules a schema cannot state. The core families use it to refuse:
- a known parent in another provider, client, host or source, or with the same
  session ID (cross-source parentage);
- known ordering whose `authority` is not the identity's `sourceId`;
- a session `id` or `subject` that is not the identity key, an occurrence or a
  turn-ended inbox item whose `session` is not, and a state event whose
  `subject` is not its `id`;
- a session `generation` after its `revision`;
- freshness that disagrees with the envelope `time`: `current` five minutes or
  more after the last evidence, or `uncertain` before that without a restart;
- a raised attention item from a turn other than the observation's;
- repeated notice IDs or unavailable dimensions;
- a moment that starts more than 60 s after the request;
- an acknowledgment whose `subject` is not a session ID, and a moment or
  playback request whose `subject` is not a routing ID.

The schemas keep the 1.x per-record rules:
- read evidence only from Codex Desktop;
- no host session ID below a known parent;
- `restartUncertain` forces `uncertain` freshness;
- a flourish never covers status;
- the credential checks on titles, projects and labels.

Display precedence holds: `sessionTitle(record)` returns the label, where a user
label always wins over an agent label, then the title. Undefined leaves the
consumer's neutral fallback.

[MAPPING.md](MAPPING.md) shows where every field of the 1.x session record,
snapshot, lifecycle observation, controller receipt, moment command, playback
snapshot, controller snapshot, general commands and status helper lands, and
lists the fields with no 2.0 home. `fixtures/v2/families.json`
has a valid message for every family. Its invalid cases name where each fails, and
its scenarios show that removal, expiry and a sync that drops a held entity leave
a consumer with exactly the owner's entities. `tests/families.test.mjs` runs them.
`tests/mapping.test.mjs` converts the 1.x corpora and a real agent-state owner's
expiry and retirement through MAPPING.md's rules.

### Device families

The device families describe every device's state and controls in one shared
shape ([Hub #918](https://github.com/jimmie-potts/agent-device-hub/issues/918)),
so the dashboard and MCP keep one set of general controls (ADR 0005). Import
them from `@jimmie-potts/event-contracts/v2/devices`. Device-specific families,
such as LIFX color, Pixoo media or Nanoleaf edits, belong to each module.

| Kind | Family | Type |
| --- | --- | --- |
| state | `device` | `org.bunny.device.updated` |
| command | `power-set`, `brightness-set`, `scene-activate`, `zone-power-set`, `media-start`, `media-control`, `device-mode-set` | `org.bunny.power.set.requested`, `.brightness.set.requested`, `.scene.activate.requested`, `.zone-power.set.requested`, `.media.start.requested`, `.media.control.requested`, `.device-mode.set.requested` |

A `device` record is the full record of one device, published by the module
that controls it, with the device `id` as its `subject`. The `id` is a routing
ID, because it is also the last token of the device's routing keys, and it must
be unique across modules, because SDK responders may not overlap. Module
configuration ([#919](https://github.com/jimmie-potts/agent-device-hub/issues/919))
and the installer ([#935](https://github.com/jimmie-potts/agent-device-hub/issues/935))
enforce that. The record holds:
- the device's `kind`, such as `nanoleaf` or `pixoo`, and an optional owner
  `label`;
- `availability`: `unknown`, `available`, `degraded` or `unavailable`. A device
  the module cannot reach is `unavailable`, which never fails the module;
- the `configurationRevision` and `generation` that commands guard on;
- `capabilities`: power, brightness, native modes, moments, media, scenes,
  zones and preview, each `{supported: false}` or `{supported: true, ...}` with
  its constraints. None is optional;
- `desired` power, brightness and native mode, and `observed` power and
  brightness with their evidence time `observedAtMs`. Each value is
  `{status: "unknown"}` or known. Missing evidence is unknown, never off, and
  only a reading from the device is an observation: never a transport
  acknowledgment or a desired value;
- `pending`, the count of accepted commands not yet completed, and
  `pendingKinds`, their command families, each once, so a dashboard can tell
  that a mode change is pending;
- `lastOutcome`, the profile's outcome payload of the last completed command;
- `lastTransmission`: unknown, or the last send that reached the device's
  transport, with its time, the operation IDs it sent and the `requestId` it
  served, if any. A module sets it for every transmitted send, including its
  own paints, which never reach the tracker. It is never an observation;
- `externalControl`: unknown, or owned by the `module` or an `external` party,
  with its evidence time.

No device record carries an address, credential or private path. The checks
refuse a desired mode the device does not advertise, an observation,
external-control reading or transmission after the envelope `time`, pending
kinds that disagree with the pending count, and a general command whose
`subject` is not a device ID.

Each general command maps one kind of controller v1's closed command union,
and its verb is the family's last word. Each carries a `requestId` and the
optional `expectedConfigurationRevision` and `expectedGeneration` guards. The
dashboard and MCP send both on a person's command, copied from the device record
they showed, and a module refuses a stale guard with `revision-conflict` before
changing anything. The Hub-mode fan-out sends none, so it never races a
device's revision. The `subject` names the device; no payload does. A module answers each device's own key,
`bunny.cmd.<family>.<device id>`, because SDK responders may not overlap.
`commandSupported(capabilities, command)` applies v1 admission's capability
rule to a general command or a `moment-play` request, and a module refuses
what it rejects with `unsupported-capability`.

`registerDeviceFamilies(validator)` registers the device families. Call it
after `registerCoreFamilies`: a device `label` uses the session family's display
text, so registering the device families alone throws.

#### Hub-mode table

The Hub mode owner asks each participating device for the native mode below
when the Hub selects a mode ([#695](https://github.com/jimmie-potts/agent-device-hub/issues/695)'s
settled decisions). `nativeMode(kind, mode)` and `HUB_MODE_TABLE` apply it, and
`tests/devices.test.mjs` keeps this table equal to the code's.

| Hub mode | Nanoleaf | Pixoo |
| --- | --- | --- |
| `work` | `work` | `monitor` |
| `free` | `free` | `media` |
| `quiet` | `quiet` | `monitor` |

LIFX, Tidbyt and playback do not take part; LIFX joins under
[#415](https://github.com/jimmie-potts/agent-device-hub/issues/415), and
per-device overrides belong to #695. The table maps one way only. A device's
native mode is never stored as the Hub's mode: Pixoo's `monitor` serves both
`work` and `quiet`, and the `mode` family refuses `monitor` and `media`.

`fixtures/v2/devices.json` has a valid message for every device family, with a
reply and an outcome for each command family. Its invalid cases name their
registry code and where each fails. `tests/devices.test.mjs` runs them, checks
each command against its target device's capabilities, checks that every
command family, `moment-play` and `playback-control` included, refuses a
subject that is not a routing ID, and checks the Hub-mode table for each
participating device kind.

### Agent status helper

`@jimmie-potts/event-contracts/v2/status` holds `sessionState`, `highestStatus`
and `STATUS_COLORS`, copied from `@jimmie-potts/agent-status` and rewritten for
`session/2.0` records (Hub #918). The 1.x package stays for the old controllers
until #839.

- `sessionState(record, consumers?)` ranks a root session: `attention` when it
  has attention, `working` when it is active or has an active child, `done`
  when a turn-ended notice lacks an acknowledgment, otherwise undefined. Read
  evidence never retires `done`. By default any consumer's acknowledgment
  retires it, as LIFX and Tidbyt use it today; `consumers` restricts that to
  the named ones. Acknowledgments are recorded per consumer, and each caller's
  policy decides which ones clear what it shows.
- `highestStatus(copy, {acknowledgingConsumers?})` takes a consumer's copy of the
  session family, `{synced, sessions}`, and returns the highest root state,
  `idle` or `unknown`. A copy that has not synced, or whose later sync failed,
  reads as `unknown`. Uncertain freshness never hides a state the owner reports.
- `STATUS_COLORS` gives every device the same color for each state.

`tests/status.test.mjs` runs the copied 1.x cases against valid `session/2.0`
records and checks that both helpers rank the same sessions alike and use the
same colors.

### How 1.x error codes merged

1.x components used several names for one condition. The registry keeps one
code for each; nothing maps 1.x codes at runtime, because 1.x retires at the
cutover. The main merges:

| 1.x names found in source | 2.0 code |
| --- | --- |
| `capacity`, `wispr-response-capacity` | `capacity` |
| `unavailable`, `wispr-unavailable`, `target-unhealthy`, and `transport-failure` before anything was sent | `unavailable` |
| `transport-failure` after sending | `uncertain-result` |
| `stale-generation` | `revision-conflict` |
| `moment-blocked` | `invalid-state` |
| `interrupted` | `cancelled` |
| `invalid-operation`, `invalid-input`, `bad` | `invalid-request` |
| `invalid-event`, `invalid-record` | `invalid-message` |
| `write-failed`, `storage-failed` | `internal` |

Domain reasons such as `composer-unfocused` or `not-enabled` are not error
codes. They go in `detail` or in the module's own payload fields.

`invalid-message` covers a message whose envelope or payload fails its schema,
including a command. `invalid-request` covers a well-formed request whose values
the owner does not accept, a command included, and a malformed request that is
not a profile message, such as an HTTP or MCP body.
