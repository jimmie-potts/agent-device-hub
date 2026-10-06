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
- nowhere. A field with **no 2.0 home** has a proposed disposition, and the coordinator decides it.

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
| `activity` | `session /activity` | `unknown`, `active`, `idle` or `interrupted`. `ended` has **no 2.0 value**: the reducer no longer produces it, and the owner settles stored `ended` records at startup. A runtime end removes the record instead. Proposed: migrate only settled stores. |
| `attention`, `attention[].id`, `attention[].kind`, `attention[].turn` | `session /attention` | Unchanged. Adding one also publishes `attention-raised`. Removing one publishes `attention-cleared` with its cause. |
| `notices`, `notices[].id`, `notices[].kind`, `notices[].turn`, `notices[].acknowledgedBy` | `session /notices` | Unchanged. These are per-consumer notices, cleared by consumer policy and gone with the record. The shared inbox's turn-ended item (`inbox-item`) is a separate durable fact that names the notice by `noticeId`. The validator refuses a repeated notice ID. |
| `read` | `session /read` | Only Codex Desktop may report `read` or `unread` (schema). |
| `unavailable`, `unavailable[].dimension`, `unavailable[].reason` | `session /unavailable` | The validator refuses a repeated dimension. |
| `unavailable[].kind` | none | Always `evidence.unavailable`, so the list name carries it. Dropped. |
| `ordering`, `ordering.status`, `ordering.epoch`, `ordering.sequence` | `session /ordering` | The ordering block. Known ordering adds `authority`, which must equal `identity.sourceId`. |
| `observedAtMs`, `lastEvidenceAtMs` | `session /observedAtMs`, `/lastEvidenceAtMs` | Unchanged. |
| `observationAgeMs` | derived | This is read context, not record content: it changes every millisecond. A consumer computes `now - lastEvidenceAtMs`. Proposed: not published. |
| `freshness` | `session /freshness` | Proposed: the owner publishes a new revision when freshness turns `uncertain` at five minutes. In 1.x a read computed it without a new revision. `restartUncertain: true` forces `uncertain` (schema). |
| `restartUncertain` | `session /restartUncertain` | Unchanged. |
| `children`, `children.active`, `children.uncertain` | `session /children` | The owner's count. The owner republishes the parent when a child changes the count. The cross-record count check in `validateSnapshot` belongs to the owner, because one record cannot check it. |
| `generation` | `session /generation` | Required. Snapshot 1.0 records read as 0. |
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
| `collector` | **no 2.0 home** | Owner health. Proposed: the runtime's module health (#830, #831), not a core family. |
| `lossCount` | **no 2.0 home** | Proposed: the same health surface. A capacity displacement still publishes its removals with reason `retired`. |

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

What the core publishes for each accepted observation:

| Event kind | Session record | Occurrence |
| --- | --- | --- |
| `session-started`, `activity-observed`, `turn-interrupted` | created or updated | none |
| `turn-started` | the new turn is current | `attention-cleared` with cause `turn-started` for each approval without a request ID that the new turn retires |
| `question-continuing`, `attention-input`, `attention-approval` | attention added | `attention-raised` |
| `attention-resolved` | the correlated attention removed | `attention-cleared` with cause `resolved` |
| `turn-ended` | a notice retained | `turn-ended`; `attention-cleared` with cause `turn-ended` for approvals without a request ID |
| `runtime-ended` | the record and its known descendants removed | `session-ended`, then one removal per record, reason `retired` |
| `notice-acknowledged`, `read-observed`, `evidence-unavailable` | updated | none |

The owner also removes records without an observation. Expiry after 24 hours
without evidence publishes a removal with reason `expired`. Displacing a finished
child subtree publishes removals with reason `retired`. Explicit approval
recovery publishes `attention-cleared` with cause `recovered`.

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
| `requestId`, `requestId.epoch`, `requestId.sequence` | reply and outcome `/requestId` | The request's string ID correlates the request, its reply and its outcome. A module that keeps `{epoch, sequence}` tickets keeps them inside its own device command family. Proposed: history migration spells a 1.x ticket `<epoch>.<sequence>`. |
| `configurationRevision` | module state `/revision` | **No core home.** The module's own device state family carries it. |
| `generation` | module state | **No core home.** The module's own device state family carries it. |
| `outcome` | reply, or outcome `/result` | See the outcome table. |
| `priorEffects` | outcome `/evidence` | `none` becomes `none`, and `confirmed-transmission` becomes `transmitted`. `possible` becomes `none` with result `uncertain`. This is an open question: ADR 0012 says `none` means nothing reached the device. |
| `completedOperations`, `uncertainOperations` | **no 2.0 home** | The profile's outcome payload is closed. Proposed: the module keeps them in its own state or history, or profile 2.1 adds an optional operations list to the outcome. |
| `failure`, `failure.code` | reply or outcome `/error` | See the error table. When codes merged, the 1.x code goes in `detail`. |

| 1.x outcome | 2.0 |
| --- | --- |
| `queued` | Reply `accepted`, with no outcome yet. |
| `sent` | Outcome `succeeded` with evidence `transmitted`. A failure code on a sent receipt is dropped, because a succeeded outcome carries no error. |
| `failed` with an admission code (`unauthenticated`, `forbidden`, `unsupported-capability`, `invalid-request`, `unknown-device`, `revision-conflict`, `stale-generation`, `request-conflict`, `request-expired`, `request-order`, `capacity`) | A reply carrying the error. 1.x retained these as the request's receipt; 2.0 refuses the request in the reply. |
| `failed` with any other code, or none | Outcome `failed` with the mapped evidence and the error. A failed receipt without a code gets `internal`. |
| `partially-applied` | Outcome `uncertain` with evidence `transmitted`, and error `uncertain-result` whose detail is `partially-applied`. |
| `uncertain` | Outcome `uncertain` with the mapped evidence and error `uncertain-result`. |
| `cancelled` | Outcome `failed` with the mapped evidence and error `cancelled`. The detail is the 1.x code when there was one, such as `stale-generation`. |

| 1.x failure code | 2.0 error code |
| --- | --- |
| `unauthenticated`, `forbidden`, `unsupported-capability`, `invalid-request`, `revision-conflict`, `capacity`, `uncertain-result` | The same code. |
| `unknown-device` | `not-found` |
| `stale-generation` | `revision-conflict` when refused at admission; `cancelled` when the queue retired it |
| `request-conflict` | `duplicate-conflict` |
| `request-expired`, `moment-missed` | `expired` |
| `request-order` | `revision-conflict`. Proposed: read again before deciding, as for a stale ticket. |
| `external-control`, `moment-blocked` | `invalid-state` |
| `moment-duplicate` | `invalid-state`. Proposed: a repeated moment ID is a state the device refuses, not a conflicting retry. |
| `transport-failure` | `unavailable` before sending; `uncertain-result` after |

## Moment request and moment state

The source is the controller 1.1 `moment` command and the snapshot's
`state.moment`. The 2.0 homes are `moment-play/2.0`, sent as
`org.bunny.moment.play.requested`, and `moment-ended/2.0`.

| 1.x field | 2.0 home | Notes |
| --- | --- | --- |
| `kind` | envelope `type` | `org.bunny.moment.play.requested`. |
| `momentId`, `palette`, `durationMs`, `priorityClass`, `coversStatus` | `moment-play /momentId`, `/palette`, `/durationMs`, `/priorityClass`, `/coversStatus` | Unchanged. A flourish never covers status (schema). |
| `mood` | `moment-play /mood` | Narrowed to kebab-case. Every mood declared today is kebab-case. |
| `start`, `start.domain`, `start.epoch`, `start.atMs`, `start.toleranceMs` | `moment-play /startAtMs`, `/toleranceMs` | **Meaning change, proposed.** Modules run in the runtime's one process and share its clock, so one wall-clock start serves every target. The per-device translation into a controller-monotonic epoch goes away. The start is at most 60,000 ms after the envelope `time` (validator). |
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
| `availability` | `playback /availability` | The owner publishes a new revision when it changes. |
| `observedAtMs` | `playback /observedAtMs` | Absent rather than null. |
| `ageMs` | derived | Read context, like `observationAgeMs`. |
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
