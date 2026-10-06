# 1.x to 2.0 field mapping

This table shows where each field of today's 1.x formats lands in the profile 2.0
core families ([Hub #842](https://github.com/jimmie-potts/agent-device-hub/issues/842)).
Nothing converts 1.x messages at runtime: 1.x retires at the cutover
([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). The
runtime's owners publish 2.0 directly, and the cutover migrates stored data with
these rules.

A field lands in one of these places:
- a field of a 2.0 family, written as `family /path`;
- an envelope attribute;
- a payload the profile owns (reply, outcome, removal, sync);
- a value consumers derive;
- the owner's own store, where it is never published;
- nowhere. A field with **no 2.0 home** has a disposition the coordinator decided on 2026-10-06.

`tests/mapping.test.mjs` checks that every field path of the 1.x schemas appears
in the first column below. It also converts the 1.x fixture corpora and a real
agent-state owner's expiry and retirement through these rules, then validates the
results.

Three conventions apply throughout:
- Event kinds become kebab-case: `attention.approval` becomes `attention-approval`.
- Known ordering `{epoch, sequence}` gains `authority`, which is the producing
  `identity.sourceId`. A lifecycle sequence is meaningful only within its source.
- A session entity's `id` and envelope `subject` are `sessionEntityId(identity)`,
  the SHA-256 of the identity with sorted keys.

## Agent-state session record

The sources are the snapshot session record (snapshot 1.0 to 1.3) and the durable
2.1 stored session. The 2.0 home is `session/2.0`, published as
`org.bunny.session.updated`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `identity`, `identity.provider`, `identity.client`, `identity.hostId`, `identity.sourceId`, `identity.sessionId` | `session /identity` | Unchanged. Codex uses `cli` or `desktop`, Claude uses `code` (schema). |
| `turn`, `turn.status`, `turn.id` | `session /turn` | Unchanged tagged known ID. |
| `parent`, `parent.status`, `parent.identity` | `session /parent` | Unchanged. A known parent must have the same provider, client, host and source and a different session ID. The validator refuses cross-source parentage, as `validateSnapshot` did through the lifecycle validator. |
| `activity` | `session /activity` | `unknown`, `active`, `idle` or `interrupted`. `ended` has **no 2.0 value**: the reducer no longer produces it, and the owner settles stored `ended` records at startup. A runtime end removes the record instead. Decided by the coordinator, 2026-10-06: migrate only stores that the 3.2 owner has already settled. |
| `attention`, `attention[].id`, `attention[].kind`, `attention[].turn` | `session /attention` | Unchanged. Adding one also publishes `attention-raised`, and removing one publishes `attention-cleared` with its cause. Both carry the whole item, including the turn it was raised on. |
| `notices`, `notices[].id`, `notices[].kind`, `notices[].turn`, `notices[].acknowledgedBy` | `session /notices` | Unchanged. These are per-consumer notices, cleared by consumer policy and gone with the record. The shared inbox's turn-ended item (`inbox-item`) is a separate durable fact that names the notice by `noticeId`. The validator refuses a repeated notice ID. |
| `read` | `session /read` | Only Codex Desktop may report `read` or `unread` (schema). |
| `unavailable`, `unavailable[].dimension`, `unavailable[].reason` | `session /unavailable` | The validator refuses a repeated dimension. |
| `unavailable[].kind` | none | Always `evidence.unavailable`, so the list name carries it. Dropped. |
| `ordering`, `ordering.status`, `ordering.epoch`, `ordering.sequence` | `session /ordering` | The ordering block. Known ordering adds `authority`, which must equal `identity.sourceId`. |
| `observedAtMs`, `lastEvidenceAtMs` | `session /observedAtMs`, `/lastEvidenceAtMs` | Unchanged. |
| `observationAgeMs` | derived | This is read context, not record content: it changes every millisecond. A consumer computes `now - lastEvidenceAtMs`. Decided by the coordinator, 2026-10-06: not published; consumers derive it. |
| `freshness` | `session /freshness` | Decided by the coordinator, 2026-10-06: the owner publishes a new revision when freshness turns `uncertain` at five minutes. In 1.x a read computed it without a new revision. `restartUncertain: true` forces `uncertain` (schema). Freshness must match the envelope `time`, as 1.x's matched `asOfMs`: `uncertain` exactly when the owner restarted since the last evidence or five minutes or more have passed (validator). For #831: an owner computes freshness at the envelope `time` of each message it sends, sync re-sends included, and when freshness has changed it bumps the revision before sending. |
| `restartUncertain` | `session /restartUncertain` | Unchanged. |
| `children`, `children.active`, `children.uncertain` | `session /children` | The owner's count. The owner republishes the parent when a child changes the count. The cross-record count check in `validateSnapshot` belongs to the owner, because one record cannot check it. |
| `generation` | `session /generation` | Required, and never after the record's `revision` (validator). Snapshot 1.0 records read as 0. |
| `label`, `labelOrigin` | `session /label` `{value, origin}` | Snapshots 1.0 and 1.1 hid agent labels, and 1.2 added `labelOrigin`. 2.0 always carries the winning label with its origin. Precedence holds: the owner never lets an agent label replace a user label, and the display order is the label, then the title, then a neutral fallback (`sessionTitle`). The label uses the lifecycle 1.1 credential check, which `setLabel` already applies. |
| `title`, `title.value`, `title.source` | `session /title` | Unchanged, with the credential check. |
| `project` | `session /project` | The display name, separate from `projectId`. |
| `projectId` | `session /projectId` | The explicit project identity. Names never merge sessions. |
| `hostSessionId` | `session /hostSessionId` | Routing metadata, never an identity. A record with a known parent never carries it (schema). |
| `retiredTurns`, `seen`, `seen[].key`, `seen[].content`, `watermarks`, `watermarks[].dimension`, `watermarks[].epoch`, `watermarks[].sequence`, `metadataObservedAtMs` | owner's store | These durable guards and watermarks stay in the core's store. No consumer reads them. |

## Agent-state snapshot

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | `https://bunny.invalid/events/session/2.0`. |
| `revision` | `sync-completed /revision`, `session /revision` | The owner's revision. Each record carries the revision of its last change. |
| `asOfMs` | envelope `time` | |
| `sessions` | one `session` state event per record; `sync-completed /members` | A sync replaces the consumer's membership. Between syncs, removal events drop entities. |
| `collector` | **no 2.0 home** | Owner health. Decided by the coordinator, 2026-10-06: the runtime's module health (#830, #831), not a core family. |
| `lossCount` | **no 2.0 home** | Decided by the coordinator, 2026-10-06: the runtime's module health (#830, #831), as for `collector`. A capacity displacement still publishes its removals with reason `retired`. |

## Lifecycle observation

The source is the lifecycle envelope 1.0 to 1.2. The 2.0 home is `lifecycle/2.0`,
which a hook publishes as `org.bunny.lifecycle.observed`. Its envelope `subject`
is `sessionEntityId(identity)`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | `https://bunny.invalid/events/lifecycle/2.0`. |
| `identity`, `identity.provider`, `identity.client`, `identity.hostId`, `identity.sourceId`, `identity.sessionId` | `lifecycle /identity` | Unchanged. |
| `turn`, `turn.status`, `turn.id` | `lifecycle /turn` | Unchanged. |
| `parent`, `parent.status`, `parent.identity` | `lifecycle /parent` | Unchanged, with the same refusal of cross-source parentage and a self parent as 1.x `validateEvent`. |
| `eventId` | `lifecycle /nativeEventId` | Renamed, so it is not confused with the envelope `id`. Native deduplication still hashes the identity, the turn and this ID. The envelope `id` is the hook's own retry identity: generated once and kept on retry, as `observedAtMs` is. |
| `event`, `event.kind` | `lifecycle /event/kind` | Kebab-case. |
| `event.attention` | `lifecycle /event/attention` | Required for `question-continuing`, `attention-input`, `attention-approval` and `attention-resolved`. |
| `event.consumerId`, `event.noticeId` | `lifecycle /event/consumerId`, `/event/noticeId` | For `notice-acknowledged`. #844 may move notice acknowledgment to a command. |
| `event.state` | `lifecycle /event/state` | For `read-observed`. Codex Desktop only (schema). |
| `event.dimension`, `event.reason` | `lifecycle /event/dimension`, `/event/reason` | For `evidence-unavailable`. |
| `observedAtMs`, `occurredAtMs` | `lifecycle /observedAtMs`, `/occurredAtMs` | Unchanged. |
| `ordering`, `ordering.status`, `ordering.epoch`, `ordering.sequence` | `lifecycle /ordering` | Known ordering adds `authority`, which equals `identity.sourceId`. |
| `projectId`, `project` | `lifecycle /projectId`, `/project` | Unchanged. |
| `label`, `label.origin`, `label.value` | `lifecycle /label` | Unchanged. 1.0 allowed only `user`; 2.0 allows both origins, as 1.1 does. |
| `title`, `title.value`, `title.source` | `lifecycle /title` | Unchanged. |
| `hostSessionId` | `lifecycle /hostSessionId` | Root observations only (schema). |

1.x had byte limits of its own: 8 KiB for the lifecycle envelope and 2,048 bytes
for an event the owner admits. In 2.0 only the profile's 256 KiB cap is in the
contract. The owner and the hook keep their own bounds.

What the core publishes for each accepted observation (agent-state `reducer.ts`
is the reference):

| Event kind | Session record | Occurrence |
| --- | --- | --- |
| `session-started`, `activity-observed`, `turn-interrupted` | created or updated; activity `active`, or `interrupted` | none of its own; see turn selection below |
| `turn-started` | activity `active`; see turn selection below | none of its own; see turn selection below |
| `question-continuing`, `attention-input`, `attention-approval` | the attention item added on the observation's turn | `attention-raised`, whose `attention.turn` is the observation's turn |
| `attention-resolved` | With a known ID on a known turn, the correlated item is removed, and so is every approval without a request ID on that turn. Otherwise attention is marked ambiguous and nothing is removed. | `attention-cleared` with cause `resolved` for each removed item |
| `turn-ended` | activity `idle`, a notice retained, and the turn's approvals without a request ID removed | `turn-ended`; `attention-cleared` with cause `turn-ended` for each removed approval |
| `runtime-ended` | the record and its known descendants removed | `session-ended`, then one removal per record, reason `retired` |
| `notice-acknowledged`, `read-observed`, `evidence-unavailable` | updated | none |

Turn selection: selecting a newer known turn retires the current one. The owner
then removes every approval without a request ID raised on a retired turn, and
publishes `attention-cleared` with cause `turn-retired` for each. In that
occurrence, `turn` is the observation's turn and `attention.turn` is the retired
turn the item was raised on. The rules below follow agent-state `reducer.ts`.

Three kinds never select or retire a turn:
- `read-observed` is read evidence, not a lifecycle observation.
- `notice-acknowledged` is applied before any turn handling.
- `runtime-ended` on a known session makes the owner retire the record before the
  reducer runs. On an unknown session it is stale.

In the rules below, an activity observation is a `session-started`,
`turn-started`, `activity-observed`, `turn-ended` or `turn-interrupted`.

An observation whose known turn is already retired never selects a turn, and an
activity observation on a retired turn is stale. An observation whose known
sequence is at or below the record's watermark for its dimension is stale too.
Otherwise the observation's known turn becomes current in one of these ways:
- Ordering is unknown and no qualified activity ordering governs the record: a
  `turn-started` selects its turn by receipt order. This is best effort.
- The record's turn is unknown: an activity observation, or any observation with
  known ordering, adopts its turn without retiring anything, unless the record's
  turn is marked ambiguous.
- Both turns are known and differ, and the observation's ordering is known and
  comparable with the record's, meaning the same epoch and a higher sequence: it
  selects its turn. Any of these kinds can: the five activity observations,
  `question-continuing`, `attention-input`, `attention-approval`,
  `attention-resolved` and `evidence-unavailable`.

The conflict path covers the remaining case: both turns are known and differ,
the observation is an activity observation or has known ordering, and the
orderings are not comparable. The owner selects no turn. It sets the turn
unknown and marks turn and ordering ambiguous. It retires the current turn only
on the best-effort path, which only an unordered `session-started`,
`activity-observed`, `turn-ended` or `turn-interrupted` for a different known
turn reaches. The retired turn's approvals are then removed with cause
`turn-retired`.

The owner also changes records without an observation:
- Expiry after 24 hours without evidence publishes a removal with reason `expired`.
- Displacing a finished child subtree publishes removals with reason `retired`.
- Explicit approval recovery publishes `attention-cleared` with cause `recovered`.
  #831 decides what an owner-started clearing carries as its observation's `turn`,
  `observedAtMs` and `ordering`, because no observation started it.
- Startup settlement of approvals on already retired turns publishes
  `attention-cleared` with cause `turn-retired`.
- Freshness turning `uncertain` publishes the record at a new revision.

## Controller receipt

The source is controller receipt 1.0 and 1.1. A 2.0 receipt splits in two:
- a reply, `org.bunny.<entity>.<verb>.replied`, accepts or refuses the request;
- an outcome, `org.bunny.<entity>.<verb>.completed`, reports the result.

Both use the payloads the profile owns. For the core's requests the replies are
`org.bunny.mode.set.replied` and `org.bunny.moment.play.replied`, and the outcomes
are `org.bunny.mode.set.completed` and `org.bunny.moment.play.completed`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | `reply/2.0` or `outcome/2.0`. |
| `controllerId` | envelope `source` | `bunny/<module>`. The module publishes; controller IDs become module-internal. |
| `deviceId` | envelope `subject` | The target. The payload names no device. |
| `requestId`, `requestId.epoch`, `requestId.sequence` | reply and outcome `/requestId` | The request's string ID correlates the request, its reply and its outcome. A module that keeps `{epoch, sequence}` tickets keeps them inside its own device command family. Decided by the coordinator, 2026-10-06: how history migration spells a 1.x ticket is deferred to the cutover's migration ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)). |
| `configurationRevision` | module state `/revision` | **No core home.** The module's own device state family carries it. |
| `generation` | module state | **No core home.** The module's own device state family carries it. |
| `outcome` | reply, or outcome `/result` | See the rule below. |
| `priorEffects` | outcome `/evidence` | See the rule below. Decided by the coordinator, 2026-10-06: evidence `none` means there is no evidence that anything reached the device, as after a failure before sending or a lost answer, and ADR 0012 says so. |
| `completedOperations`, `uncertainOperations` | **no 2.0 home** | The profile's outcome payload is closed. Decided by the coordinator, 2026-10-06: the module keeps them in its own device state and command families. Profile 2.0's outcome stays unchanged, with no 2.1 operations list now. |
| `failure`, `failure.code` | reply or outcome `/error` | See the rule and the error table below. |

The receipt rule, applied in this order:
1. `queued` becomes the reply `accepted`, with no outcome yet.
2. Any receipt with `priorEffects: possible` becomes the outcome `uncertain` with
   evidence `none` and error `uncertain-result`, whatever its 1.x outcome. This
   includes `failed` and `cancelled`: LIFX, for one, reports a write cut short
   by a generation change as `cancelled` with `possible`. Decided by the
   coordinator, 2026-10-06.
3. Otherwise the evidence follows `priorEffects`: `none` stays `none`, and
   `confirmed-transmission` becomes `transmitted`.
   - `sent` becomes `succeeded` with `transmitted`. A failure code on a sent
     receipt is dropped, because a succeeded outcome carries no error.
   - `failed` with an admission code (`unauthenticated`, `forbidden`,
     `unsupported-capability`, `invalid-request`, `unknown-device`,
     `revision-conflict`, `stale-generation`, `request-conflict`,
     `request-expired`, `request-order` or `capacity`) becomes a reply carrying
     the error. 1.x kept these as the request's receipt; 2.0 refuses the request
     in the reply.
   - `failed` with `confirmed-transmission` and the code `uncertain-result` or
     `transport-failure` was sent and then lost its answer. It becomes
     `uncertain` with `transmitted` and error `uncertain-result`, as the
     profile's lost-answer scenario reports it. Decided by the coordinator,
     2026-10-06.
   - `failed` with any other code becomes `failed` with the error. Without a
     code, the error is `internal`.
   - `partially-applied` and `uncertain` become `uncertain` with error
     `uncertain-result`.
   - `cancelled` becomes `failed` with error `cancelled`.

The error's `detail` is the 1.x failure code. Without one, it is the 1.x outcome
when the 2.0 result renames it, such as `partially-applied`, or `cancelled` under
rule 2. The detail is omitted when it equals the 2.0 code.

The coordinator accepted these code mappings on 2026-10-06.

| 1.x failure code | 2.0 error code |
| --- | --- |
| `unauthenticated`, `forbidden`, `unsupported-capability`, `invalid-request`, `revision-conflict`, `capacity`, `uncertain-result` | The same code. |
| `unknown-device` | `not-found` |
| `stale-generation` | `revision-conflict` when refused at admission; `cancelled` when the queue retired it |
| `request-conflict` | `duplicate-conflict` |
| `request-expired`, `moment-missed` | `expired` |
| `request-order` | `revision-conflict`: read again before deciding, as for a stale ticket. Decided by the coordinator, 2026-10-06. |
| `external-control`, `moment-blocked` | `invalid-state` |
| `moment-duplicate` | `invalid-state`: a repeated moment ID is a state the device refuses, not a conflicting retry. Decided by the coordinator, 2026-10-06. |
| `transport-failure` | `unavailable` before sending; `uncertain-result` after |

## Moment request and moment state

The source is the controller 1.1 `moment` command and the snapshot's
`state.moment`. The 2.0 homes are `moment-play/2.0`, sent as
`org.bunny.moment.play.requested`, and `moment-ended/2.0`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `kind` | envelope `type` | `org.bunny.moment.play.requested`. |
| `momentId`, `palette`, `durationMs`, `priorityClass`, `coversStatus` | `moment-play /momentId`, `/palette`, `/durationMs`, `/priorityClass`, `/coversStatus` | Unchanged. A flourish never covers status (schema). |
| `mood` | `moment-play /mood` | Narrowed to kebab-case. Every mood declared today is kebab-case. Decided by the coordinator, 2026-10-06. |
| `start`, `start.domain`, `start.epoch`, `start.atMs`, `start.toleranceMs` | `moment-play /startAtMs`, `/toleranceMs` | **Meaning change.** Decided by the coordinator, 2026-10-06. Modules run in the runtime's one process and share its clock, so one wall-clock start serves every target. The per-device translation into a controller-monotonic epoch goes away: a module converts `startAtMs` to a deadline on its own monotonic clock when the request arrives. The start is at most 60,000 ms after the envelope `time` (validator). |
| `state.moment.last` (`momentId`, `requestId`, `ending`, `endedAt`) | `moment-ended` occurrence | `endedAt` becomes `endedAtMs` on the runtime's clock. |
| `state.moment.current` | module state | Device state. The module's own family carries it. |

The request envelope's `controllerId`, `deviceId`, `expectedConfigurationRevision`
and `expectedGeneration` move to the envelope `subject` or into the module, as in
the receipt.

## Playback snapshot

The source is the Hub's `/api/playback/v1/snapshot`. The 2.0 home is
`playback/2.0`, published as `org.bunny.playback.updated`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | |
| `sourceId` | `playback /id` | The envelope subject. |
| `availability` | `playback /availability` | The owner publishes a new revision when it changes. Decided by the coordinator, 2026-10-06. |
| `observedAtMs` | `playback /observedAtMs` | Absent rather than null. |
| `ageMs` | derived | Read context, like `observationAgeMs`. Decided by the coordinator, 2026-10-06: consumers derive it. |
| `playback` | `playback /playback` | Null becomes `{"status": "unknown"}`. |
| `playback.status` | `playback /playback/player` | Renamed, because `status` now tags known and unknown. |
| `playback.title`, `playback.artist`, `playback.album`, `playback.controls` | `playback /playback/title`, `/artist`, `/album`, `/controls` | Unchanged. |

## Mode

1.x has no Hub mode: Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media are device
modes in controller snapshots, and their modules keep them. `mode/2.0` is the
Hub's own selection, which [#695](https://github.com/jimmie-potts/agent-device-hub/issues/695)
owns, and `mode-set/2.0` requests it. Profile 1.0's unused
`org.bunny.selection.committed` (`mode` `Work`, `Free` or `Quiet`) maps to
`mode /mode` in lowercase.
