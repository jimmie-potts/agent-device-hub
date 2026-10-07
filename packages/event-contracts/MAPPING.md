# 1.x to 2.0 field mapping

This table shows where each field of today's 1.x formats lands in the profile 2.0
core families ([Hub #842](https://github.com/jimmie-potts/agent-device-hub/issues/842))
and device families ([Hub #918](https://github.com/jimmie-potts/agent-device-hub/issues/918)).
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
- nowhere. A field with **no 2.0 home** has a recorded disposition. The coordinator
  decided those of #842 on 2026-10-06; #918 set those of the controller snapshot
  and the general commands.

`tests/mapping.test.mjs` checks that every field path of the 1.x schemas appears
in the first column below. It also converts the 1.x fixture corpora and a real
agent-state owner's expiry and retirement through these rules, then validates the
results. For the controller contract it walks the snapshot, its capabilities, the
request and each kind of the general command union, and fails on any field this
table does not name.

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
| `freshness` | `session /freshness` | Decided by the coordinator, 2026-10-06: the owner publishes a new revision when freshness turns `uncertain` at five minutes. In 1.x a read computed it without a new revision. `restartUncertain: true` forces `uncertain` (schema). Freshness must match the envelope `time`, as 1.x's matched `asOfMs`: `uncertain` exactly when the owner restarted since the last evidence or five minutes or more have passed (validator). An owner computes freshness at the envelope `time` of each message it sends, sync re-sends included, and when freshness has changed it bumps the revision before sending. The core (#831) publishes the record again on a timer when it turns uncertain, and brings freshness up to date before it serves a sync. |
| `restartUncertain` | `session /restartUncertain` | Unchanged. |
| `children`, `children.active`, `children.uncertain` | `session /children` | The owner's count. The owner republishes the parent when a child changes the count. The cross-record count check in `validateSnapshot` belongs to the owner, because one record cannot check it. |
| `generation` | `session /generation` | Required, and never after the record's `revision` (validator). Snapshot 1.0 records read as 0. |
| `label`, `labelOrigin` | `session /label` `{value, origin}` | Snapshots 1.0 and 1.1 hid agent labels, and 1.2 added `labelOrigin`. 2.0 always carries the winning label with its origin. Precedence holds: the owner never lets an agent label replace a user label, and the display order is the label, then the title, then a neutral fallback (`sessionTitle`). The label uses the lifecycle 1.1 credential check, which `setLabel` already applies. |
| `title`, `title.value`, `title.source` | `session /title` | Unchanged, with the credential check. |
| `project` | `session /project` | The display name, separate from `projectId`. |
| `projectId` | `session /projectId` | The explicit project identity. Names never merge sessions. |
| `hostSessionId` | `session /hostSessionId` | Routing metadata, never an identity. A record with a known parent never carries it (schema). 1.x kept it in owner memory only; the core (#831) keeps it with the record in its private store, so it survives a restart. |
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
| `event.consumerId`, `event.noticeId` | `notice-acknowledge /consumerId`, `/noticeId` | A `notice.acknowledged` observation becomes the `notice-acknowledge` command (#918), which a consumer sends to the core with the session's `id` as its subject; the `lifecycle` family refuses the event. The notice ID must be the SHA-256 hash the owner gives every notice. 1.x accepted any neutral ID, but one naming anything else could only ever be stale, so 2.0 refuses it. |
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
| `read-observed`, `evidence-unavailable` | updated | none |

Turn selection: selecting a newer known turn retires the current one. The owner
then removes every approval without a request ID raised on a retired turn, and
publishes `attention-cleared` with cause `turn-retired` for each. In that
occurrence, `turn` is the observation's turn and `attention.turn` is the retired
turn the item was raised on. The rules below follow agent-state `reducer.ts`.

Two kinds never select or retire a turn:
- `read-observed` is read evidence, not a lifecycle observation.
- `runtime-ended` on a known session makes the owner retire the record before the
  reducer runs. On an unknown session it is stale.

A `notice-acknowledge` command is not an observation either. The core answers it
through agent-state's `acknowledge`, which adds the consumer to the notice's
`acknowledgedBy` and publishes the session record at a new revision, in the
command's trace, with no occurrence and no turn handling. Acknowledgments are recorded per consumer, and
each consumer's policy decides which acknowledgments clear what it shows, as today:
LIFX and Tidbyt clear a finished turn on any consumer's acknowledgment.

The core's reply (#831):

| Case | Reply |
| --- | --- |
| Recorded, or recorded before | `accepted` |
| The session or the notice is unknown | `not-found` |
| The consumer is not one the core records acknowledgments for | `invalid-request` |
| The sender's source does not end in the consumer ID, such as `bunny/modules/nanoleaf` for `pixoo` | `forbidden` |
| The core store is full | `capacity` |
| The core store failed for another reason, with nothing committed | `internal` |
| The core is stopping, or cannot take changes now | `unavailable` |

A consumer acknowledges for itself only, so one consumer cannot clear what
another shows. The acknowledgment commits before the reply, so `accepted` reports
a committed change. The session's state at its new revision is the evidence; no
outcome follows, and it is not a tracked kind.

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
- Startup settlement of approvals on already retired turns publishes
  `attention-cleared` with cause `turn-retired`.
- Freshness turning `uncertain` publishes the record at a new revision.

No observation starts the recovery or the startup settlement, so the core (#831)
decided what those clearings carry in the observation's place:
- `turn`: the session's current turn when the owner cleared the item;
- `observedAtMs`: the owner's instant of the change;
- `ordering`: unknown, because the owner is no provider and has no sequence to
  claim.

`occurredAtMs` is absent, and `attention.turn` is still the turn the item was
raised on.

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
the receipt. The general commands keep the two guards; see
[General commands](#general-commands).

## Playback snapshot

The source is the Hub's `/api/playback/v1/snapshot`. The 2.0 home is
`playback/2.0`, published as `org.bunny.playback.updated`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | |
| `sourceId` | `playback /id` | The envelope subject. It is also the record's routing-key token, so 2.0 narrows it to lowercase letters and digits with single hyphens (the blocks' `routingId`, Hub #918); 1.x allowed any neutral ID. A configured ID outside that form is renamed when the installer converts the configuration (#929, [#935](https://github.com/jimmie-potts/agent-device-hub/issues/935)). |
| `availability` | `playback /availability` | The owner publishes a new revision when it changes. Decided by the coordinator, 2026-10-06. |
| `observedAtMs` | `playback /observedAtMs` | Absent rather than null. |
| `ageMs` | derived | Read context, like `observationAgeMs`. Decided by the coordinator, 2026-10-06: consumers derive it. |
| `playback` | `playback /playback` | Null becomes `{"status": "unknown"}`. |
| `playback.status` | `playback /playback/player` | Renamed, because `status` now tags known and unknown. |
| `playback.title`, `playback.artist`, `playback.album`, `playback.controls` | `playback /playback/title`, `/artist`, `/album`, `/controls` | Unchanged. |

A request for one of the `controls` goes to the record's owner as
`playback-control` (#918), whose subject is the record's `id`.

## Mode

1.x has no Hub mode: Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media are device
modes in controller snapshots, and their modules keep them as native modes in
`device /desired/mode` and `/capabilities/modes`. The Hub-mode table in the
[README](README.md#hub-mode-table) maps the Hub's mode to each participating
device kind's native mode, one way only. `mode/2.0` is the
Hub's own selection, which [#695](https://github.com/jimmie-potts/agent-device-hub/issues/695)
owns, and `mode-set/2.0` requests it. Profile 1.0's unused
`org.bunny.selection.committed` (`mode` `Work`, `Free` or `Quiet`) maps to
`mode /mode` in lowercase.

## Controller snapshot

The source is the controller contract 1.0 and 1.1 snapshot, `snapshot` and
`snapshotV1_1`, with its capabilities. The 2.0 home is `device/2.0`, which the
module that controls the device publishes as `org.bunny.device.updated`. Device
records are not migrated: each module publishes its devices fresh after the
cutover ([#840](https://github.com/jimmie-potts/agent-device-hub/issues/840)).
The record's `kind`, such as `nanoleaf` or `pixoo`, is new; 1.x kept it in the
Hub's controller configuration.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | `https://bunny.invalid/events/device/2.0`. |
| `identity`, `identity.deviceId` | `device /id` | The envelope subject. It is also the last token of the device's routing keys, so 2.0 narrows it to the blocks' `routingId`: lowercase letters and digits with single hyphens, at most 128 characters. 1.x allowed any neutral ID. It must be unique across modules, because SDK responders may not overlap. |
| `identity.controllerId`, `identity.sourceId` | envelope `source` | `bunny/modules/<module>`. Controller and source IDs become module-internal. |
| `identity.controllerEpoch` | owner's store | The module's own continuity. Consumers follow `revision` and resync instead. |
| `identity.label` | `device /label` | The owner's label, at most 80 characters, with the session family's display-text and credential checks. |
| `configurationRevision` | `device /configurationRevision` | Unchanged. Commands guard on it with `expectedConfigurationRevision`. |
| `generation`, `generation.epoch`, `generation.sequence` | `device /generation` | Unchanged ticket. Commands guard on it with `expectedGeneration`. |
| `nextRequestId` | **no 2.0 home** | #918: the requester chooses a command's string `requestId`, and the retry identity is `(source, id)`. After a lost reply a client reads the device record or the tracker ([#782](https://github.com/jimmie-potts/agent-device-hub/issues/782)) instead of resubmitting. |
| `cursor` | **no 2.0 home** | #918: the sync revision replaces the feed cursor (`sync-completed /revision`, `device /revision`). |
| `sampleClock`, `sampleClock.domain`, `sampleClock.epoch`, `sampleClock.sampledAtMs` | envelope `time` | Modules share the runtime's clock, so the controller-monotonic clock goes away, as for the moment start (coordinator decision, 2026-10-06). |
| `serviceHealth` | `device /availability` | `ready` becomes `available`; `unknown`, `degraded` and `unavailable` are unchanged. `unavailable` means the module cannot reach the device, which never fails the module (module failure policy A, owner decision 2026-10-06). A health check is never an observation. |
| `capabilities` | `device /capabilities` | Every capability is required in 2.0. |
| `capabilities.power`, `capabilities.power.supported` | `device /capabilities/power` | Unchanged. |
| `capabilities.brightness`, `capabilities.brightness.supported`, `capabilities.brightness.minimum`, `capabilities.brightness.maximum` | `device /capabilities/brightness` | Unchanged: 0 to 100. |
| `capabilities.media`, `capabilities.media.supported`, `capabilities.media.actions`, `capabilities.media.playlistIds`, `capabilities.media.renditionIds` | `device /capabilities/media` | Unchanged. |
| `capabilities.zones`, `capabilities.zones.supported`, `capabilities.zones.zoneIds` | `device /capabilities/zones` | Unchanged. |
| `capabilities.scenes`, `capabilities.scenes.supported`, `capabilities.scenes.sceneIds` | `device /capabilities/scenes` | Unchanged. |
| `capabilities.preview`, `capabilities.preview.supported`, `capabilities.preview.profiles`, `capabilities.preview.profiles[].profileId`, `capabilities.preview.profiles[].profileVersion` | `device /capabilities/preview` | Unchanged. A preview profile never implies physical accuracy. |
| `capabilities.modes`, `capabilities.modes.supported`, `capabilities.modes.values` | `device /capabilities/modes` | Required: a 1.0 snapshot without `modes` becomes `{"supported": false}`. The values are the device's native modes in kebab-case, so `Work` becomes `work` and `Monitor` becomes `monitor`. They are never the Hub's mode. |
| `capabilities.moments`, `capabilities.moments.supported`, `capabilities.moments.moods`, `capabilities.moments.maxDurationMs`, `capabilities.moments.coversStatus` | `device /capabilities/moments` | Required: a 1.0 snapshot without `moments` becomes `{"supported": false}`. Moods are kebab-case, as `moment-play /mood` is. |
| `limits`, `limits.maxPending`, `limits.maxBodyBytes`, `limits.maxInFlight`, `limits.maxReceipts`, `limits.maxEvents`, `limits.maxStreams`, `limits.authenticationTimeoutMs` | **no 2.0 home** | #918: these bound the controller HTTP endpoint, which retires with 1.x ([#839](https://github.com/jimmie-potts/agent-device-hub/issues/839)). The profile's 256 KiB cap and the SDK's queue bounds replace them, and each module keeps its own pending bound. |
| `state` | `device` | The state fields sit at the record's top level. |
| `state.desired`, `state.desired.power`, `state.desired.power.status`, `state.desired.power.value`, `state.desired.brightness`, `state.desired.brightness.status`, `state.desired.brightness.value`, `state.desired.mode`, `state.desired.mode.status`, `state.desired.mode.value` | `device /desired` | Unchanged tagged values; the mode is a native mode in kebab-case. A known desired mode is one the device advertises (validator). |
| `state.pending` | `device /pending` | The count of accepted commands not yet completed. `pendingKinds` is empty exactly when it is 0 (validator). |
| `state.pending[].command.kind` | `device /pendingKinds` | The family of each pending command, each family once: `mode.set` becomes `device-mode-set`, `moment` becomes `moment-play`, and so on, as in [General commands](#general-commands). A dashboard asks it, for example, whether a mode change is pending. |
| `state.pending[].requestId`, `state.pending[].generation`, `state.pending[].command`, `state.pending[].command.on`, `state.pending[].command.percent`, `state.pending[].command.sceneId`, `state.pending[].command.zoneId`, `state.pending[].command.playlistId`, `state.pending[].command.action`, `state.pending[].command.mode`, `state.pending[].command.momentId`, `state.pending[].command.mood`, `state.pending[].command.palette`, `state.pending[].command.durationMs`, `state.pending[].command.priorityClass`, `state.pending[].command.coversStatus`, `state.pending[].command.start`, `state.pending[].command.start.domain`, `state.pending[].command.start.epoch`, `state.pending[].command.start.atMs`, `state.pending[].command.start.toleranceMs` | **no 2.0 home** | #918: the core's tracker (#782) records each request from sent to completed, and the module keeps its own queue, so the record keeps the count and the kinds. Each command's fields map as in [General commands](#general-commands) and [Moment request](#moment-request-and-moment-state). |
| `state.lastSuccessfulSend`, `state.lastSuccessfulSend.status` | `device /lastTransmission` | The last send that reached the device's transport, kept through later failures as in 1.x. A module sets it for every transmitted send, its own paints included, which never reach the tracker. It is never an observation. |
| `state.lastSuccessfulSend.requestId` | `device /lastTransmission/requestId` | A string, as in [Controller receipt](#controller-receipt). Optional in 2.0: a paint the module makes itself serves no request. |
| `state.lastSuccessfulSend.clock` | `device /lastTransmission/transmittedAtMs` | On the runtime's clock. |
| `state.lastSuccessfulSend.operationIds` | `device /lastTransmission/operationIds` | Unchanged: at most 256 unique IDs. |
| `state.lastOutcome`, `state.lastOutcome.status`, `state.lastOutcome.receipt`, `state.lastOutcome.receipt.apiVersion`, `state.lastOutcome.receipt.controllerId`, `state.lastOutcome.receipt.deviceId`, `state.lastOutcome.receipt.requestId`, `state.lastOutcome.receipt.configurationRevision`, `state.lastOutcome.receipt.generation`, `state.lastOutcome.receipt.outcome`, `state.lastOutcome.receipt.priorEffects`, `state.lastOutcome.receipt.completedOperations`, `state.lastOutcome.receipt.uncertainOperations`, `state.lastOutcome.receipt.failure`, `state.lastOutcome.receipt.failure.code` | `device /lastOutcome` | `receipt` becomes `outcome`, the profile's outcome payload, by the receipt rule in [Controller receipt](#controller-receipt). A receipt that the rule turns into a reply refused its request and is not a completed outcome. |
| `state.externalControl`, `state.externalControl.status`, `state.externalControl.owner`, `state.externalControl.clock` | `device /externalControl` | `owner` `controller` becomes `module`; `external` is unchanged. `clock` becomes `observedAtMs`, on the runtime's clock. |
| `state.observation`, `state.observation.status`, `state.observation.clock`, `state.observation.power`, `state.observation.brightness` | `device /observed` | `clock` becomes `observedAtMs`, the evidence time on the runtime's clock. Missing evidence stays `{"status": "unknown"}`. Only a reading from the device sets it: never a health check, a desired value or a transport acknowledgment. |
| `state.observation.evidenceAgeMs` | derived | Read context, like `observationAgeMs`: consumers compute `now - observedAtMs`. |
| `state.moment`, `state.moment.current`, `state.moment.current.status`, `state.moment.current.momentId`, `state.moment.current.requestId`, `state.moment.current.mood`, `state.moment.current.priorityClass`, `state.moment.current.coversStatus`, `state.moment.current.startAt`, `state.moment.current.startAt.domain`, `state.moment.current.startAt.epoch`, `state.moment.current.startAt.atMs`, `state.moment.current.toleranceMs`, `state.moment.current.durationMs`, `state.moment.current.endAt` | module state | As [Moment request](#moment-request-and-moment-state) decided: the module's own family carries the current moment. |
| `state.moment.last`, `state.moment.last.status`, `state.moment.last.momentId`, `state.moment.last.requestId`, `state.moment.last.ending`, `state.moment.last.endedAt` | `moment-ended` occurrence | As [Moment request](#moment-request-and-moment-state) decided. |

## General commands

The source is the controller 1.0 `request` and its closed `command` union. Each
kind of the union becomes its own command family, sent as
`org.bunny.<entity>.<verb>.requested`, whose verb is the family's last word. The
module that controls the device answers it with the profile's reply and outcome,
and refuses an operation the device does not offer with `unsupported-capability`
(`commandSupported`, the 1.x admission rule).

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `apiVersion` | envelope `dataschema` | The family's schema, such as `https://bunny.invalid/events/power-set/2.0`. |
| `controllerId` | the routing key | The module answers `bunny.cmd.<family>.<device id>`. |
| `deviceId` | envelope `subject` | The payload names no device. The subject must be a device ID (validator). |
| `requestId`, `requestId.epoch`, `requestId.sequence` | `/requestId` | A string, as in [Controller receipt](#controller-receipt). How history migration spells a 1.x ticket is deferred to #840. |
| `expectedConfigurationRevision` | `/expectedConfigurationRevision` | Optional in 2.0. A stale one is refused with `revision-conflict` before any change. |
| `expectedGeneration` | `/expectedGeneration` | Optional in 2.0. A stale one is refused with `revision-conflict` before any change. |
| `command`, `command.kind` | envelope `type` and `dataschema` | One family for each kind, below. |
| `power.set`, `on` | `power-set /on` | `org.bunny.power.set.requested`. |
| `brightness.set`, `percent` | `brightness-set /percent` | `org.bunny.brightness.set.requested`. 0 to 100. |
| `scene.activate`, `sceneId` | `scene-activate /sceneId` | `org.bunny.scene.activate.requested`. |
| `zone.power.set`, `zoneId`, `on` | `zone-power-set /zoneId`, `/on` | `org.bunny.zone-power.set.requested`. |
| `media.start`, `playlistId` | `media-start /playlistId` | `org.bunny.media.start.requested`. |
| `media.control`, `action` | `media-control /action` | `org.bunny.media.control.requested`. The seven 1.x actions. |
| `mode.set`, `mode` | `device-mode-set /mode` | `org.bunny.device-mode.set.requested`. A native mode in kebab-case that the device advertises, never the Hub's mode. |

API 1.1's `moment` command maps to `moment-play` as
[Moment request](#moment-request-and-moment-state) describes.

## Agent status

The source is `@jimmie-potts/agent-status`'s status helper, which LIFX and Tidbyt
use today. The 2.0 home is `@jimmie-potts/event-contracts/v2/status`, a copy
rewritten for `session/2.0` records. The 1.x package stays for the old
controllers until #839.

| 1.x name | 2.0 home | Notes |
| --- | --- | --- |
| `sessionState` | `sessionState(record, consumers?)` | The same ranking on a `session/2.0` record: attention, then working, then done. Read evidence never retires done. |
| `highestStatus` | `highestStatus(copy, options)` | Reads a consumer's copy of the session family, `{synced, sessions}`, instead of a snapshot. |
| `HighestStatusOptions.feedAvailable` | `copy.synced` | A copy that has not synced, or whose later sync failed, reads as `unknown`. |
| `HighestStatusOptions.acknowledgingConsumers` | `HighestStatusOptions.acknowledgingConsumers` | Unchanged: without it, any consumer's acknowledgment retires done. |
| `Snapshot.collector` | **no 2.0 home** | Owner health is the runtime's module health (#830, #831), as decided for the snapshot's `collector`. A consumer sees an owner that cannot serve it as a sync that fails. |
| `STATUS_COLORS` | `STATUS_COLORS` | The same colors on every device; a test keeps them equal to 1.x. |
