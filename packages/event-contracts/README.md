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
    registry's error detail. `seal()` makes every later `register` throw, so
    owners that share one validator accept the same messages.
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
| occurrence | `volcano-observation` (a collector's VOLCANO HYBRID snapshot for the Volcano module) | `org.bunny.volcano-observation.observed` |
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
- `volcano-observation` ([Hub #615](https://github.com/jimmie-potts/agent-device-hub/issues/615))
  carries one bounded snapshot of one enrolled VOLCANO HYBRID:
  `{feed, observedAtMs, collectorEpoch, sequence, link, reading}`. `feed` is
  `{provider: 'storz-bickel', client: 'volcano', hostId, sourceId}`, and the
  envelope `subject` and the key's last token are `volcanoFeedId(feed)`.
  `collectorEpoch` names one collector process and `sequence` counts its
  snapshots. `link` is `connected`, `disconnected`, `unavailable` or
  `identity-mismatch`; `reading` is null unless the link is connected, and
  otherwise holds the raw `status1` and `status2` registers, `currentDeciC` and
  `targetDeciC` (degrees Celsius times ten whatever the device displays) and the
  raw `heatingHours` and `heatingMinutes` counters, each null when unread. No
  serial, Bluetooth address or firmware travels here. A host-local collector
  publishes it with a source-bound `ingest` credential derived from the feed and
  `feed: 'volcano-observation'`, which the runtime's edge requires on every
  entry. Only the Volcano module consumes it; the core ignores it and history
  does not keep it.
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
must use its kind and type. `coreValidator()` returns the process's one sealed
validator with exactly these families, compiled on first use. An owner that
needs only the core families uses it rather than compiling its own copy, because
each copy blocks the event loop while Ajv compiles it, about 50 ms on a fast
machine (Hub #1503). Its type offers only `validate`, so registering on the
shared, sealed instance fails typecheck instead of throwing while an owner
starts (Hub #1537). `MessageValidator.register` takes an optional check
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

The default schemas keep the 1.x per-record rules:
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

### Explicit client read receipts (`lifecycle/2.1`, opt-in)

`@jimmie-potts/event-contracts/v2/read-receipts` exports
`registerReadReceiptFamily`, `ReadReceiptObservation`, `ReadReceiptQualification`
and `decideReadReceipt`. Call the registration function after
`registerCoreFamilies`. Default core-family and SDK registration excludes this
lifecycle version and rejects it with `unsupported-version`. The runtime
explicitly registers it for the qualified producer described in its
[read-receipt guide](../../apps/runtime/READ-RECEIPTS.md).
`readReceiptValidator()` returns the process's one sealed validator with the
core families and this family, compiled on first use. The runtime's core
validates with it instead of compiling a copy at each start (Hub #1534). Like
`coreValidator()`, its type offers only `validate`.

The version accepts existing lifecycle/2.0 observations with their existing
rules and adds `read-receipt-observed`. A receipt carries the full native session
identity, a known turn, unknown parentage, observation time and ordering. Its
event names the owner's session `generation` and 64-character finished
`noticeId`. Bind these at the observed action; never look up a newer target to
replace missing or delayed evidence. Shared Mac Codex remains `codex/local` and
Claude remains `claude/code`.

Receipt provenance has two closed forms:

- `provider-client` carries `client: desktop`, `seenRevision` and
  `acceptedRevision`. It means an observed successful client read request and
  response after a completed turn, not a snapshot or a missing unread marker.
- `owned-ui` carries `viewRevision`. It means the application owns the view
  action and has qualified its policy. A generic rendering callback is not a
  qualified view action.

Provider revisions are opaque tokens of 1–128 ASCII letters, digits, underscores,
periods, hyphens or colons. Preserve native tokens such as `initial:<thread-id>`;
the application-owned view revision keeps the shared identifier rule. Do not
sort revisions or treat them as proof of human comprehension. The new observation
admits no prompt, response, transcript,
title, archive metadata or credential field. A future adapter must select the
declared fields before persistence, transmission and diagnostics; native API
responses can contain content outside this contract.

`decideReadReceipt(input, session, qualification)` validates untrusted input and
returns eligibility without changing anything. Qualification comes from the
trusted caller and must match the authenticated message source, complete feed
and receipt kind. The current session must match the full identity, generation,
known turn and named turn-ended notice. Only idle or interrupted sessions without
known parents qualify. Lifecycle freshness, attention and other consumers'
acknowledgments stay independent. The helper can accept an old finished result
without declaring the agent fresh or connected.

The pure helper does not implement state transitions. The runtime core rechecks
eligibility and the exact owner view revision in its serialized operation and
commits read evidence, history and outbox together. Its session/2.1 output
requires `read: read` and closed `readReceipt` provenance: `noticeId`,
`observedAtMs`, authenticated `source` and the receipt. The notice must belong
to the known current finished turn, with no known parent. Current core-family
registration accepts this output version. Records without provenance keep
session/2.0; that schema and the retained 1.x reducer still restrict positive
read evidence to Codex Desktop. Schema acceptance alone does not qualify a
client. See the
[qualification findings](../../docs/research/explicit-read-receipts.md).

`tests/read-receipts.test.mjs` covers both provider identities, both receipt
forms, malformed and stale evidence, unchanged default registration, old
observation compatibility and immutable reference decisions. Existing event CI
discovers this suite.

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
| state | `device` (2.0, 2.1 with `held`, and 2.2 with `moments.art`) | `org.bunny.device.updated` |
| command | `power-set`, `brightness-set`, `scene-activate`, `zone-power-set`, `media-start`, `media-control`, `device-mode-set` | `org.bunny.power.set.requested`, `.brightness.set.requested`, `.scene.activate.requested`, `.zone-power.set.requested`, `.media.start.requested`, `.media.control.requested`, `.device-mode.set.requested` |

`media-start` and `media-control` keep an optional `requireMode` member
([#1276](https://github.com/jimmie-potts/agent-device-hub/issues/1276)), a
native mode name, because removing a member from a closed 2.0 minor is not
additive. No module admits by it any more
([ADR 0014](../../docs/decisions/0014-pixoo-follows-the-hub-mode.md)): the
Pixoo, the only module that ever read it, refuses a command that carries it with
`invalid-request` before any device write, and the core sends none. Routines
carry their own Hub-mode precondition, which the core checks against the
device's reported mode before sending. Nanoleaf and Tidbyt refuse both families
as unsupported before the member matters.

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
| `work` | `work` | `work` |
| `free` | `free` | `free` |
| `quiet` | `quiet` | `quiet` |

LIFX, Tidbyt and playback do not take part; LIFX joins under
[#415](https://github.com/jimmie-potts/agent-device-hub/issues/415), and
per-device overrides use the same mapping. Since
[ADR 0014](../../docs/decisions/0014-pixoo-follows-the-hub-mode.md) the Pixoo
takes the Hub's values as its native modes, as the Nanoleaf does; its former
`monitor` and `media` are no longer advertised, so a `device-mode-set` naming
either is unsupported. The table maps one way only. A device's native mode is
never stored as the Hub's mode, and the `mode` family refuses any value other
than `work`, `free` and `quiet`.

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

## Exact-artwork payloads

The additive `./v2/art` entry supplies the art families, registered with the core
families. [The qualification record](../../docs/art-generation-qualification.md#exact-artwork-handoff)
owns the handoff and its policy.

| Family | Type | Sender and purpose |
| --- | --- | --- |
| `art-request` | `org.bunny.art.request.requested` | The dashboard, for the owner. Starts a job, or cancels any job, automatic or not, by its `jobRequestId`. Subject `art`. |
| `art-auto` | `org.bunny.art.auto.requested` | `bunny/core`. Version 2.0 starts an automatic job; 2.1 also prepares saved display art or selects saved browser art. No typed text or cancel. Subject `art`. |
| `art-dispatch` | `org.bunny.art.dispatch.requested` | `bunny/modules/art`, to the core: forward one `art-stage` or `art-ambient-set` to `target`. Never a moment. Subject `art`. |
| `art-stage` | `org.bunny.art.stage.requested` | The core, for the art module. The device keeps a private copy, with no display effect. Subject: the device. |
| `art-ambient-set` | `org.bunny.art-ambient.set.requested` | The core, for the art module. The device's ambient tile shows `compositionId`, or none when it is null. Subject: the device. |
| `art-show` | `org.bunny.art.show.requested` | Any caller with control, through the core's dispatcher, to the core: show one saved `artworkId` now on one to three `targets` (configured display IDs and `browser`), with optional `coversStatus`, default true. Subject `hub`. |

- **Showing saved art now.** `art-show/2.0` (Hub #1581) carries no text, duration or
  composition: the core picks each target's saved composition. The browser-safe
  `./v2/art-show` entry derives a show's plan ID and each surface's preparation,
  moment or present request ID with WebCrypto (`artShowSurfaces(requestId, targets)`),
  exactly as the core tracks them, so a consumer reads those operation records.
  The show's own outcome is the core's observed handoff, never display evidence.
- **Who decides ownership.** The command family decides whether a job is the
  owner's. `origin` and `purpose` are descriptive, so `art-auto` with an owner label
  validates and stays automatic.
- **Saved art.** `art-auto/2.1` retains the 2.0 start and adds closed `prepare`
  and `present` actions. Both name `artworkId` and `compositionId`; preparation
  also names the exact configured device `target`. Neither generates art.
  Preparation success means the target finished staging that composition.
  Presentation success means the browser selection was committed, never that a
  browser displayed it. Admission alone proves neither result.
- **Bounds.** `text` is at most 2,000 characters, and weather is at most 64
  characters of lowercase condition words. Payloads are closed: none has a member for
  a location, path or credential.
- **A stage's bytes.** `art-stage` carries `compositionId`, `format` (`png` or `gif`),
  `width`, `height`, `frames`, `durationMs`, `sha256`, `base64` and `lifetimeMs`, from
  one minute to thirty days. `base64` is at most `MAX_ART_BYTES` (160 KiB) decoded. The
  validator checks the encoding, size, hash, format and header dimensions, and never
  decodes the image. A PNG has one frame and `durationMs` 0. The largest stage and its
  dispatch fit the 256 KiB message cap.
- Art uses `art-dispatch/2.0` and the core forwards `art-stage/2.0` through 256 frames.
  For a longer GIF, Art sends `art-dispatch/2.2` only to a Pixoo whose current
  `device/2.4` record declares `capabilities.moments.art.stageVersion: "2.1"`,
  GIF support and sufficient `maxBytes`. The core checks its copy from the configured
  device owner before admitting the tracked `art-stage/2.1`. This stage accepts a
  positive safe-integer frame count. Both versions bound decoded media at 160 KiB
  and duration at 300,000 ms. The device verifies decoded frames during staging.
- **A device's copy.** `artStageDecision(held, stage, nowMs)` answers `store` or `reuse`
  with the renewed record, and `duplicate-conflict` for the same ID with other bytes.
  `artReferenceRefusal(held, nowMs)` answers `not-found` for a copy the device does not
  hold or one that has lapsed, whose detail says to stage it again, or nothing to admit
  it. It never answers `expired`, because the tracker reads that code as a command that
  did not reach its owner. A device keeps its copy for a moment under way, so neither
  expiry nor deletion can take it from one.
- **Who may send.** The in-process bus checks no sender. The rule binds at the gateway,
  the tracker and each responder: `art-stage`, `art-ambient-set`, a moment naming art,
  `art-request` and `art-auto` responders refuse any source other than `bunny/core`
  with `forbidden`, using `artCommandRefusal(command.source)`, as
  `modules/companions/src/module.ts` does. Do this before validating or acting.
- **Capability.** `device/2.2` is `device/2.1` with an optional
  `capabilities.moments.art: {formats, maxBytes}`. `commandSupported` refuses a moment
  with `art` for a device without it, so the device does not play its mood instead, and
  `artStageSupported(capabilities, stage)` checks a stage's format and size.
- **Playing it.** `moment-play/2.1` is `moment-play/2.0` with an optional
  `art: {compositionId}`. The gateway builds every client's moment as 2.0, which refuses
  `art`. `moment-play/2.0`, `device/2.0` and `device/2.1` are unchanged.
- **Stage finished.** After its `accepted` reply, a display publishes one outcome through
  its outbox once its private copy is durable:
  - key `bunny.event.art-stage.<device>`, kind `outcome`, subject `<device>`;
  - type `org.bunny.art.stage.completed`, schema `https://bunny.invalid/events/outcome/2.0`;
  - data `{requestId, result, evidence}`, with `evidence` `observed` for a stored copy, and
    `error` when it failed.

  An ambient set does the same on `bunny.event.art-ambient-set.<device>` with type
  `org.bunny.art-ambient.set.completed`. The core takes it only from the participant that
  replied.
- **Reading the result.** A module learns that a stage finished from the core's
  `operation` record for its `requestId`, found with `operationEntityId`. It shows
  nothing until that record says `succeeded`. `accepted` proves no effect. The core can
  retire a settled record after 256 newer ones, and background art has no inbox item, so
  the durable evidence is the tracker row and history. A module keeps its own result.
- **Send again.** Inbox send-again refuses a moment naming art with `forbidden`, because
  a fresh one must pass arbitration under #684, and refuses a stage because its payload
  was not kept.

## Art state

`art/2.0` (`v2/art-state`) is the art module's complete record, on
`bunny.state.art.art`: spent, reserved, uncertain and remaining micro-dollars per
provider, the loop guard, recent jobs and artworks by reference, staged candidates and
what retention holds. It carries no prompt, key, location or image bytes. Read bytes
through the module's content references, `artContentRef`. `art-catalog-edit/2.0` is the
owner's favorite, feedback, delete and reuse command. The module registers both, so
they are not core families. `v2/art` owns the job and handoff families.

`art/2.1` adds required `selection`, either null or `{artworkId, compositionId}`.
It names the authoritative saved browser composition, including one outside the
recent page. It carries no pixels or palette evidence. The 2.0 schema and its
`ArtState` type remain unchanged; `ArtState21` names the extended record and
`ArtRecord` accepts either version. Both minor versions remain registered.

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

### Reachy simulator dispatch

`reachy-dispatch/2.0` is an internal command from `bunny/modules/reachy-mini`
to the core. It forwards an eligible finite automatic reaction through tracked
dispatch, preserving the candidate’s absolute `validUntilMs`. It grants no
external motion access. Manual controls and module-owned state are described in
[the Reachy guide](../../modules/reachy-mini/README.md).

`microduck-dispatch/2.0` is the internal finite head-expression dispatch from
`bunny/modules/microduck` to the core, with subject `microduck`. It carries a
configured target, notice/attention, original opportunity/expiry and current
configuration/generation guards. Only that module may request it; the core
tracks one microduck-auto operation. Public HTTP/SDK grants and MCP cannot invoke
internal dispatch. Robot-local schemas remain owned by the module.

### Home art reservations

The core publishes `home-layout/2.1`. It keeps the version-1 arrangement record
and adds optional `art: {format, pinned}` metadata on the `art` widget only.
`format` is `auto`, `banner`, `square` or `tall`; `pinned` is a boolean. Old
arrangements remain valid. The registered `home-layout/2.0` schema is unchanged.
The existing `home-layout-set/2.0` command accepts this optional metadata, using
the additive optional-command-field convention; its revision guard and outcomes
are unchanged. The private core store needs no migration.

Art placement stores no artwork identity, media, provider settings or feedback.
Only explicit owner actions save layout options. Automatic free-space fitting
never publishes a command. The art module continues to own the catalog and
`art-catalog-edit/2.0` handles explicit favorite and feedback changes.

An older Home save that retains the art placement but omits its optional options
preserves the saved format and pin. Explicit options replace them; removing the
reservation or resetting the arrangement still removes them.

### Home card shapes

The core publishes `home-layout/2.2` (#1672): 2.1 plus an optional `shape` on any
placement, `square`, `wide`, `tall` or `large-square`. `size` stays required, so
`home-layout/2.0` and 2.1 records stay valid and a dashboard that knows only
widths keeps working. `homeShapeSize` gives the width stored beside each shape:
`small` for square and tall, `medium` for wide and large-square. The existing
`home-layout-set/2.0` command references the 2.2 layouts and accepts `shape` as
an additive optional field; its revision guard and outcomes are unchanged. The
core keeps a saved shape only while the placement's `size` agrees with it, and
keeps the previous shape when a save omits it but keeps the width. For art the
format must also agree (`homeArtShapes`: banner Wide, tall Tall, square Small or
Large square, auto Large square), so an older dashboard's format change drops a
copied or omitted shape and the format decides. The private
core store needs no migration. A core older than 2.2 refuses saves whose entries
carry `shape`; a width-only save is accepted and removes the shapes. The recovery steps are in the runtime dashboard guide and the runtime upgrade guide (Home arrangement state).

### Selected microphone capture (`music-capture-*/2.1`)

`registerMusicCaptureFamilies` registers unchanged 2.0 schemas and five additive
2.1 schemas for endpoint, work, features, control and state. The browser-safe
`v2/music-capture-data` export owns their shared constants and types; the server
module re-exports them and retains validation. Endpoint capability contains only
`microphone: {id}`. Microphone start and feature records use `input: "microphone"`
and `microphoneId`, a bounded public alias. Device UIDs and names are forbidden.
Configured capability says nothing about device presence or authorization.

The core publishes one `music-capture-state/2.2` record through both sync and live
updates, including for Music-only producers. Bundled readers explicitly accept
state 2.0, 2.1 and 2.2. They do not treat an unknown version as compatible. Music start
and all stop work remain 2.0; microphone start uses 2.1. Music features remain
2.0; microphone features use 2.1. Progress and endpoint-loss contracts remain 2.0.
Existing 2.0 schemas are unchanged and reject microphone fields. This follows the
same registered-version migration as `device/2.1`; state is never dual-published.
The capture tests cover accepted versions, closed fields and bounds, and
source/alias association. The dashboard gates each meter by that provenance.

### Quiet calibration and response (`music-capture-control/state/2.2`)

Control 2.2 adds `calibrate`, `cancel-calibration` and `apply-tuning`, each naming
the current capture revision and exact endpoint/generation/alias/format binding.
Apply also names `expectedSettingsRevision`; a stale editor cannot overwrite
newer settings by adopting a later capture revision. Cancel names its measurement
operation. Existing start/stop commands keep their prior selected versions.

State 2.2 adds a required `response` record: settings revision, bounded settings,
current application binding, calibration attempt and latest successful evidence.
Sensitivity is 0.1–8, smoothing 0–2000 ms, each broad-band emphasis 0–4 and a
linear RMS gate threshold 0–16. Gates are off, explicitly manual or associated
with a measured candidate. Evidence holds 50 windows/5000 ms, the observed 95th
percentile and maximum, and a heuristic suggested threshold. It contains no UID,
PCM, physical loudness or beat estimate. Retired qualification clears the current
binding while retaining preferences and evidence. All earlier schema files and
Music/microphone raw feature meanings remain unchanged. The core never
dual-publishes state.

### Coding worker readiness and outcomes (`coding-*/2.1`)

The `./v2/coding` entry (Hub #502) registers the coding families with the core
families. Hub #1743 adds three versions beside the unchanged 2.0 schemas:

- `coding-endpoint/2.1`: an `enable` may carry `readiness`, the worker's
  harness as it reported itself without starting a task: `installed` and
  `signedIn` (`yes`, `no` or `unknown`), `version` and `plan` (or null), the
  latest run's limit `windows` with status, `resetsAtMs` and `utilization` (or
  null), `limitsObservedAtMs` and `checkedAtMs`. A `disable` never carries it.
- `coding-state/2.1`: requires `readiness`, the selected endpoint's latest
  record or null.
- `coding-progress/2.1`: a result may have the outcome `usage-limit`, which
  carries `limit: {window, resetsAtMs}` (each null where the tool gave none) and
  ends `failed` with reason `usage-limit`, or `waiting-for-owner`. A `limit`
  appears with that outcome only.

The worker publishes 2.1 progress and endpoint commands and the companions
module publishes 2.1 state; a 2.0 message stays valid and refuses the new
members. The credential role's families are unchanged. `tests/coding.test.mjs`
covers both versions.

### Music lighting sessions (`music-lighting-*/2.0`)

`registerMusicLightingFamilies` registers four new families, all at 2.0, for the first live Music lighting trial (#1272, #722, policy in #40). The browser-safe `v2/music-lighting-data` export owns their types and reason lists.

| Family | Kind | Sender to owner | Subject |
|---|---|---|---|
| `music-lighting-control` | command | operator to core | target light |
| `music-lighting-state` | state | core | target light |
| `music-lighting-work` | command | core to the light's module | target light |
| `music-lighting-device` | state | light's module | target light |

Control starts with `capture: {endpointId, generation}` and a saved `presetId`, or stops, both with `expectedRevision`. It never carries a mode, an inline recipe or an input choice. Work carries the core's session `generation`.

State records name their own light. An ending is `{generation, reason, restoration, atMs}`:

- Reasons: `stopped`, `alert`, `manual`, `source-lost`, `device`, `restart`, `expired` or `refused`.
- Restorations: `restored`, `skipped`, `none` or `uncertain` (a restoration write's answer was lost).
- An optional `code`, an error code, names the refusal or failure behind a `refused`, `expired` or `device` ending.

A device record's ending must name its session's generation. The tests are in `tests/music-lighting.test.mjs`.

