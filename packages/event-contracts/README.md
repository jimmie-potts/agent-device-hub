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
  - `@jimmie-potts/event-contracts/v2/errors` holds the registry, `errorBody`,
    `ErrorBody`, `ErrorDetail`, `MAX_DETAIL` and `SCHEMA_BASE` in a module that
    reads no file and loads no validator, so a browser part can bundle them
    (Hub #922); the `v2` entry exports the same values.
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
and is registered under `https://bunny.invalid/events/<family>/2.0`, with explicitly
registered minor versions where extended. No family
carries a device-specific payload: modules define those.

| Kind | Family | Type |
| --- | --- | --- |
| state | `session`, `mode`, `inbox-item`, `playback`, `operation`, `power-limit` | `org.bunny.<family>.updated` |
| occurrence | `lifecycle` (hook or Desktop metadata evidence for the core) | `org.bunny.lifecycle.observed` |
| occurrence | `desktop-metadata` (a collector's Codex Desktop metadata snapshot for the Desktop module) | `org.bunny.desktop-metadata.observed` |
| occurrence | `attention-raised`, `attention-cleared`, `turn-ended`, `session-ended` | `org.bunny.attention.raised`, `.attention.cleared`, `.turn.ended`, `.session.ended` |
| occurrence | `moment-ended` | `org.bunny.moment.ended` |
| occurrence | `outcome-recorded` (the core's outcome acknowledgment) | `org.bunny.outcome.recorded` |
| command | `mode-set`, `mode-override-set`, `moment-play` | `org.bunny.mode.set.requested`, `org.bunny.mode-override.set.requested`, `org.bunny.moment.play.requested` |
| command | `notice-acknowledge`, `playback-control` | `org.bunny.notice.acknowledge.requested`, `org.bunny.playback.control.requested` |
| command | `approval-recover` | `org.bunny.approval.recover.requested` |
| command | `notice-clear` | `org.bunny.notice.clear.requested` |
| command | `session-label-set` | `org.bunny.session-label.set.requested` |

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
- `notice-clear` (Hub #1009) is a tracked operator-only override with `requestId`, selected `noticeId` (a 64-character notice hash or null), and required `expectedRevision`. Its subject is the qualified session entity ID. The runtime refuses a changed latest notice/revision, acknowledges every configured consumer atomically, and records the profile's observed metadata completion. Null selects no notice and changes no session state. The family supplies no wire permission flag, provider read evidence or physical-device receipt.
- `session-label-set` (Hub #1006) is a tracked operator command with
  `{requestId, label, expectedRevision}` and the qualified session ID as its
  subject. A string sets a user label; null clears it. Labels admit 1–80 Unicode
  scalar values under the existing display-text and credential-exclusion rules.
  The core refuses a stale session revision with `revision-conflict` and an
  unknown session with `not-found`. Its completed outcome uses `outcome/2.0`;
  observed evidence means the metadata committed, with no physical observation.
- `metadata-observed` (Hub #990) adds Desktop metadata to `lifecycle/2.0`,
  with optional `event.archived` and the existing `title`; at least one is
  required. It uses Codex Desktop identity, unknown turn and ordering, and
  unknown or top-level parentage. It carries no label, project, project ID, host session
  ID, native event ID or occurrence instant. The core accepts it only from
  `bunny/modules/codex-desktop`. Archive evidence guards new admission;
  titles update known roots without refreshing activity or restart evidence.
  This additive input has no lifecycle 1.x equivalent and emits no synthetic
  lifecycle, read or notice occurrence.
- `desktop-metadata` ([Hub #567](https://github.com/jimmie-potts/agent-device-hub/issues/567))
  carries one bounded snapshot of Codex Desktop's metadata inputs for one feed:
  `{feed, observedAtMs, stamp, unread, archived, titles}`. `feed` is a Codex
  Desktop identity without its session, and the envelope `subject` and the key's
  last token are `desktopFeedId(feed)`. `unread` (at most 4,096 IDs) and
  `archived` (at most 2,048) are null when their input is missing, unusable or
  over its bounds; `titles` holds at most 512 provider titles. No ID repeats in
  any of them. A host-local collector publishes it with a source-bound `ingest`
  credential derived from the feed and `feed: 'desktop-metadata'`, which the
  runtime's edge requires on every entry. The Codex Desktop module consumes it
  and alone turns a snapshot into lifecycle evidence; the core ignores it.
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
- `operation` (Hub #922) is the latest state of one action the core tracks
  (#782), including tracked core-local metadata changes. Its `kind` is the
  tracker's existing category and deadline class (`device`, `moment` or `mode`),
  not proof of a physical target; `family` and `target` identify the action. The core publishes it
  from the tracker's change, in the same transaction, and serves it through
  sync, so a display shows an action requested (`sent`), `accepted` and
  `completed` without reading the tracker, whose row stays the authority. Its
  `id` is `operationEntityId(requestId)`, the lowercase hex SHA-256 of the
  request ID, and its `command` is its family's type; the validator refuses
  either otherwise. `result` is absent while the action is `sent` or `accepted`
  and present after; a failed one carries its error, and a succeeded one
  `transmitted` or `observed` evidence of the action's effect. An accepted reply is never evidence
  that anything was done. The record carries no command payload. The core
  keeps the latest records only, removing the oldest settled one with reason
  `retired` after each tracked change, never a pending one. Pending records may
  exceed the limit until settlement permits pruning; tracker/history rows remain.
  The inbox (#923) points at an operation by
  its request ID.
- `playback-control` asks the owner of the `playback` record (#929) for play,
  pause, next or previous. The owner sends it once, to the source presented at
  admission, and never redirects or retries it. The record's `id`, and so the
  command's `subject`, is a routing ID.
- A `moment-play` request's `subject` is the target device's ID.
- `outcome-recorded` is the outcome acknowledgment
  ([Hub #782](https://github.com/jimmie-potts/agent-device-hub/issues/782)): the
  core tells a module that it recorded one of the module's outcomes, `{source, id}`,
  on `bunny.event.outcome-recorded.<module>` (`outcomeRecordedKey(source)`), with
  the outcome's message `id` as its `subject`. Only the core sends it
  (`CORE_SOURCE`, `bunny/core`), after it committed the outcome and its
  `(source, id)`, and again for each exact duplicate. A module's outbox forgets
  the outcome only when the sender is the core.
- `inbox-item/2.0` remains registered. Additive `inbox-item/2.1` holds failed,
  uncertain or conflicting operations and late definitive evidence, including
  success while an item stays open. Conflict carries two opposite definitive
  outcomes. Items stay until handled, without expiry; `dismissedBy` remains a
  separate display fact. A handled item is removed with reason `deleted`.
- `inbox-handle/2.0` (Hub #923) is the direct core command with `requestId`,
  `expectedRevision` and action `dismiss` or `send-again`, targeting its inbox ID.
  Its authenticated source supplies the actor. Send-again uses a fresh tracked
  request and saved data; it never automatically retries or replays commands.
- A removal event, with reason `expired`, `retired` or `deleted`, drops an
  entity. A sync replaces the consumer's membership of the synced families.

`registerCoreFamilies(validator)` registers every family. A family's messages
must use its kind and type. `MessageValidator.register` takes an optional check
for rules a schema cannot state. The core families use it to refuse:
- a known parent in another provider, client, host or source, or with the same
  session ID (cross-source parentage);
- known ordering whose `authority` is not the identity's `sourceId`;
- a session `id` or `subject` that is not the identity key, an occurrence whose
  `session` is not, and a state event whose `subject` is not its `id`;
- an outcome acknowledgment from any source but the core, or whose `subject` is
  not the outcome's `id`;
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

### Playback card placement (`playback-layout/2.0`)

Core owns one private presentation record with `id: playback`, a revision and at
most 64 `{playback, rooms}` assignments. Each logical playback ID is unique;
its at most 32 room IDs are unique routing IDs. Closed schemas exclude names,
media and addresses. `playback-layout-set/2.0` replaces assignments with a request
identity and expected revision through dedicated operator admission. State is
accepted only from `bunny/core` with subject `playback`. The save and observed
metadata outcome commit atomically; this evidence establishes no audible effect.
Existing lighting-layout definitions own room identity. Consumers omit removed
rooms; a retained dangling ID never creates a room or chooses an audio output.

### Playback artwork (`playback/2.1`)

`registerCoreFamilies` registers both unchanged `playback/2.0` and `playback/2.1`. The new version adds optional top-level `artwork` for available/stale, known playing/paused records. Its closed branches are `{status: "missing" | "unsupported", generation}` and ready state with `generation`, `mediaType: "image/png"`, `width`, `height` and canonical padded `base64`. The opaque generation is a UUID v4; image dimensions are 1–128 and decoded bytes at most 65,536. The validator checks encoding, PNG signature and IHDR dimensions without decoding image contents on the bus thread. The producer performs full decoding and normalization. These checks do not prove arbitrary compressed contents are decodable.

Receiver addresses, URLs and source identities are absent. Sync and live copies preserve the same shared bytes; no asset endpoint or receiver read is needed. Existing 2.0 records remain valid and cannot carry artwork. Unknown versions and fields, invalid associations and oversized image state are refused. `tests/playback-artwork.test.mjs` covers these boundaries; retained Python fixtures test 1.x regression compatibility rather than introduce a Python 2.1 mirror.

### Device families

The device families describe every device's state and controls in one shared
shape ([Hub #918](https://github.com/jimmie-potts/agent-device-hub/issues/918)),
so the dashboard and MCP keep one set of general controls (ADR 0005). Import
them from `@jimmie-potts/event-contracts/v2/devices`. Device-specific families,
such as LIFX color, Pixoo media or Nanoleaf edits, belong to each module.

| Kind | Family | Type |
| --- | --- | --- |
| state | `device` (2.0, and 2.1 with `held`) | `org.bunny.device.updated` |
| command | `power-set`, `brightness-set`, `scene-activate`, `zone-power-set`, `media-start`, `media-control`, `device-mode-set` | `org.bunny.power.set.requested`, `.brightness.set.requested`, `.scene.activate.requested`, `.zone-power.set.requested`, `.media.start.requested`, `.media.control.requested`, `.device-mode.set.requested` |

`media-start` and `media-control` take an optional `requireMode`
([#1276](https://github.com/jimmie-potts/agent-device-hub/issues/1276)): a
native mode the device must be in. The module refuses the command with
`invalid-state` at admission, before any device write, when the device's
current mode differs or a mode change is pending, so a scheduled playlist never
displaces a status display. The field is added in place to the two 2.0
schemas, as #1185 widened `session/2.0`, rather than as a new minor version
beside them: an optional command field changes no consumer's reading of an
existing message, so every valid 2.0 command stays valid and one without
`requireMode` behaves as before. A module that answers these families owes the
field its check: it refuses a mode the device does not advertise with
`unsupported-capability`, and a current mode that differs, or a pending
`device-mode-set`, with `invalid-state`, before any device write. Today only the
Pixoo answers them for a device that supports media; Nanoleaf and Tidbyt refuse
both families as unsupported before the field matters.

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

#### Held devices (`device/2.1`)

A module holds a device after a write that may have reached it but went
unanswered. ADR 0012 never retries that write, and the module sends the device
no other write until the hold is released
([Hub #975](https://github.com/jimmie-potts/agent-device-hub/issues/975)).
`device/2.1` is `device/2.0` with one more optional member, `held`, which shows
the hold:
- **What it means.** `held` is present exactly while the hold lasts and absent
  otherwise. `requestId` names the operation whose uncertain write holds the
  device. That operation's outcome is `uncertain` with `uncertain-result`, and
  the tracker and the operation's one inbox item carry the same request ID.
  `heldAtMs` is when the hold began.
- **How it clears.** The module releases the hold after a person's next
  command to the device, or once a later definitive outcome settles the held
  operation. Its next record has no `held`. Each module's README names the
  commands that release a hold. Power-only Wemo plugs use the explicit
  `wemo-hold-release/2.0` command as a narrow exception: it requires the held
  request, current configuration and generation, then reads fresh identity and
  power before clearing the hold. It sends no power command and does not retry
  or change the original uncertain operation. Other modules keep their existing
  command-based recovery.
- **Availability.** A held device is never `available`: it is `degraded` while
  it answers, `unavailable` while it does not, and `unknown` before it has
  answered. The checks refuse a held `available` record and a hold that begins
  after the envelope `time`.
- **Versions.** `deviceFamilies` and `registerDeviceFamilies` carry both
  versions, so every validator accepts both. A 2.0 record stays valid, and a
  2.0 record that carries `held` is refused. Each producer chooses one version.
  The Nanoleaf module publishes 2.1; LIFX, playback, Pixoo and Tidbyt hold no
  device and publish 2.0. A consumer keys on the family, not the version.
  `schemas/v2/families/device.2.1.schema.json` is the 2.0 schema plus `held`,
  and a test keeps the two equal apart from `held`, `$id` and the description.

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
per-device overrides use the same mapping. The table maps one way only. A device's
native mode is never stored as the Hub's mode: Pixoo's `monitor` serves both
`work` and `quiet`, and the `mode` family refuses `monitor` and `media`.

`mode/2.1` extends the existing global fields with `overrides`, at most 128
unique `{target, mode, selectedAtMs}` choices differing from the global mode.
The closed `mode/2.0` schema remains registered. `mode-override-set/2.0` uses a
device subject and the same `mode`, `requestId`, optional `expectedRevision`
payload as `mode-set/2.0`. Both go through the core dispatcher. A global
selection clears all overrides; an individual selection equal to the global
mode clears only its target. Saved choices and native outcomes are separate.
The browser-safe `v2/mode` export supplies `normalizeModeState` for old/new saved
records and `effectiveMode(record, target, live)` for explicit override/global
fallback. Missing or stale state returns no effective choice; the helper sends
nothing and retains nothing. Its synthetic consumer test covers future companion
use without implementing companion behavior.

`fixtures/v2/devices.json` has a valid message for every device family, a held
`device/2.1` record among them, with a reply and an outcome for each command
family. Its invalid cases name their
registry code and where each fails. `tests/devices.test.mjs` runs them, checks
each command against its target device's capabilities, checks that every
command family, `moment-play` and `playback-control` included, refuses a
subject that is not a routing ID, checks the Hub-mode table for each
participating device kind, and checks that `device/2.1` is `device/2.0` plus
`held`, with every 2.0 record valid under both versions.

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

## Companion payloads

The additive `./v2/companions` entry supplies the `companion-opportunity`,
`companion-state`, `companion-settings-set` and `companion-fixture-run` families.
They are registered with the shared core families. Core publishes qualified
first-live coding opportunities; the optional companion module owns its state
and the two tracked commands. Opportunities retain origin, revision/generation,
known identity and a thirty-second validity bound. Scenario identity/location
remain unknown; rule and text-selection implementation stays module-local.
Schemas and consumer checks join `test:events:built`.

The same entry adds `preference-state/2.0`, a closed metadata-only document
`{id: "preferences", revision}` on subject `preferences`. It belongs to the
companions sync owner; title, text, entries and history are excluded. Private
preference reads and mutations remain in the [owning module](../../modules/companions/README.md#explicit-preferences).

### Browser speech payloads

The same entry registers these profile-2.0 families for the selected browser
endpoint. Browser permissions remain the runtime gateway's responsibility.

| Family | Kind | Producer and purpose |
| --- | --- | --- |
| `companion-speech-endpoint` | Command | The current endpoint explicitly declares availability, mutes or stops. Enable requires `available: true`. |
| `companion-speech-dispatch` | Command | Companions asks the core to track one admitted candidate. It carries candidate and endpoint references. |
| `companion-speech-play` | Command | The core transfers responsibility for that candidate to companions. |
| `companion-speech-output` | Command | Companions submits a current live card once to its selected endpoint, or stops that operation. History and scenario cards are refused. |
| `companion-speech-playback` | Occurrence | The endpoint reports bounded playback status and whether a start callback occurred. |
| `companion-speech-lost` | Occurrence | The gateway reports that the named endpoint closed. |
| `companion-speech-state` | State | Companions reports its reservation, availability, playback and pending-work flag. |

Endpoint command subjects and playback subjects are routing IDs. Loss names the
same ID in its subject and payload. Dispatch, play and state name `reachy`.
Output expiry cannot exceed the opportunity deadline. Playback observations
distinguish started, completed, stopped, failed, not-started and uncertain;
completion requires a reported start. These observations do not claim that a
person heard speech and do not replace the existing tracked command outcome.
Payloads carry no voice inventory, stream capability or raw browser error.
