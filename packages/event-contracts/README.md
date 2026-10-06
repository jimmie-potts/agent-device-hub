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
  `kind`. Commands and sync requests require `expiresat`; no other kind may
  carry it. The `type` suffix must match the kind, for example
  `org.bunny.<entity>.<verb>.requested` for a command. Only sync messages may use
  `org.bunny.sync.requested` and `org.bunny.sync.completed`.
- `schemas/v2/blocks.schema.json`: building blocks for payloads. These are
  identifiers, `<name>AtMs` instants, revisions, the `{epoch, sequence}`
  ticket, ordering, tagged unknown values, kebab-case enum values, entity
  references and the error body.
- `schemas/v2/kinds.schema.json`: payloads the profile owns for replies,
  completed outcomes, removals, sync requests and `sync.completed`. An outcome
  is `succeeded`, `failed` or `uncertain`, with evidence `transmitted`,
  `observed` or `none`. `none` means there is no evidence that anything reached
  the device, as after a failure before sending or a lost answer. A succeeded
  outcome always has `transmitted` or `observed` evidence, and a failed one
  carries an error.
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
  - `errorBody(code, extra)`, which builds `{"error":{...}}`, takes
    `retryable` from the registry and throws on extras the error block would
    refuse.
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
runs it, the core family and mapping tests, and the 1.0 tests.

### Core payload families

The core families are the facts every module can rely on
([Hub #842](https://github.com/jimmie-potts/agent-device-hub/issues/842)).
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
- a moment that starts more than 60 s after the request.

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
snapshot, lifecycle observation, controller receipt, moment command and playback
snapshot lands, and lists the fields with no 2.0 home. `fixtures/v2/families.json`
has a valid message for every family. Its invalid cases name where each fails, and
its scenarios show that removal, expiry and a sync that drops a held entity leave
a consumer with exactly the owner's entities. `tests/families.test.mjs` runs them.
`tests/mapping.test.mjs` converts the 1.x corpora and a real agent-state owner's
expiry and retirement through MAPPING.md's rules.

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
