# Controller contract v1

[Hub #4](https://github.com/jimmie-potts/agent-device-hub/issues/4) adds these contract schemas, shared fixtures and pure validators. It does not implement a controller, writer, network listener, MCP endpoint or renderer. [Hub #292](https://github.com/jimmie-potts/agent-device-hub/issues/292) adds API 1.1, which carries [moments](#moments-api-11) under [ADR 0006](decisions/0006-hub-moments-and-interludes.md). API 1.0 is unchanged.

## Artifact layout

- packages/contracts/package.json: private versioned source artifact `@jimmie-potts/device-contracts`, version `1.1.0`, publishable through explicit artifact packaging without public registry publication.
- packages/contracts/schemas/controller-v1.schema.json: strict Draft 2020-12 envelope schemas using `$defs`. API 1.1 adds separate definitions with a `V1_1` suffix, such as `requestV1_1` and `snapshotV1_1`, plus `momentCommand` and `momentState`. The 1.0 definitions are unchanged.
- packages/contracts/fixtures/controller-v1.json: all language-neutral schema and semantic cases, with inputs and expected results.
- packages/contracts/src/index.ts: schema loading/export and pure admission, replay, feed, clock, moment and 1.0-view reference functions only.
- packages/contracts/python/agent_device_hub_contracts/: Python consumer of the identical schema/fixtures, with matching pure reference functions.
- packages/contracts/tests/: TypeScript tests consume the shared JSON cases. Python tests do the same. They must fail when expected outputs differ; merely checking fixture shape does not establish semantics.
- docs/controller-contract.md: normative behavior, HTTP mapping, privacy, adoption and compatibility.
- docs/development.md and CI: build/typecheck plus TypeScript and Python contract tests, in addition to the existing workflow checks.

Prefer schema definitions and small explicit reference functions over generated runtime frameworks. Consumers need no database or device to exercise these fixtures.

## Wire values and identity

All common objects reject unknown fields. Both consumers reject JSON nested more than 32 levels before schema validation, returning invalid-request without reserving a command. Valid v1 envelopes fit well below this bound. API versions are the literals `"1.0"` and `"1.1"`; the contract artifact is `1.1.0`. IDs are neutral, operator-configured strings, bounded to 128 ASCII letters/digits/underscore/hyphen/dot. Labels are optional, at most 80 Unicode characters, and can originate only from explicit user input. Do not copy media/session titles or paths into labels automatically. Revision and sequence numbers are nonnegative safe integers, at most 9007199254740991, to avoid TypeScript/Python disagreement. Epoch IDs are opaque bounded neutral IDs, never clocks or credentials.

An identity contains `deviceId`, `controllerId`, `sourceId`, and `controllerEpoch`. Stable configured IDs survive ordinary restarts; the runtime epoch changes whenever replay or clock continuity cannot be preserved. The controller registers device destinations privately. Neither identities nor commands contain destination addresses, credentials, filesystem paths, firmware/reset operations or raw protocol commands. A configuration change that redirects an existing identity requires operator authority; it is not a generic client operation.

## Capabilities and operations

Capabilities explicitly list `power`, `brightness`, `media`, `zones`, `scenes`, `preview`. Each is a tagged union `{supported:false}` or `{supported:true,...typed constraints...}`. Power requires boolean values. Brightness requires integer 0 through 100. Media accepts existing `playlistId`/`renditionId`, plus a finite enum of supported player actions. Zones and scenes use configured IDs, each collection bounded to 256 IDs. Preview declares device-specific profile IDs; capability declaration never implies physical accuracy. Ordinary light examples set media/preview false and never acquire an RGB frame interface implicitly.

Command is a closed discriminated union:

- `{kind:"power.set", on:boolean}`
- `{kind:"brightness.set", percent:integer}`
- `{kind:"scene.activate", sceneId:Id}`
- `{kind:"zone.power.set", zoneId:Id, on:boolean}`
- `{kind:"media.start", playlistId:Id}`
- `{kind:"media.control", action:"pause"|"resume"|"stop"|"next"|"previous"|"restart-with-changes"|"clear"}`
- `{kind:"mode.set", mode:device-advertised enum}` requires the optional typed `modes` capability. Preserve Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media; never map them to a common global mode.

API 1.1 adds a `moment` command and a `moments` capability; see [Moments](#moments-api-11). Discovery, snapshot and preview retrieval are reads. They cannot advance animation queues, clear notices, allocate zones or issue writes. Optional device profiles may add typed operations through separately versioned schemas and advertised compatibility. V1 has no arbitrary extension-command object or raw renderer command.

## Request, receipt and observations

A command request contains `apiVersion`, identity selector `controllerId`/`deviceId`, `requestId:{epoch,sequence}`, `expectedConfigurationRevision`, `expectedGeneration:{epoch,sequence}`, and `command`. Device snapshots issue `nextRequestId`; clients do not construct fresh identities after a lost response. Configuration revisions serialize accepted desired changes. Generations retire output work when controller policy replaces, stops or cancels it. Generation epoch changes across continuity loss; comparing sequence alone is invalid.

Receipt contains the same identity/request ID, `configurationRevision`, `generation`, `outcome`, `priorEffects`, and optional typed `failure`. Outcomes are `queued`, `sent`, `failed`, `partially-applied`, `uncertain`, `cancelled`. `sent` means successful transport only. `priorEffects` is `none`, `possible`, or `confirmed-transmission`; no value asserts optical effect. Typed failures include `unauthenticated`, `forbidden`, `unsupported-capability`, `invalid-request`, `unknown-device`, `revision-conflict`, `stale-generation`, `request-conflict`, `request-expired`, `request-order`, `capacity`, `external-control`, `transport-failure`, and `uncertain-result`. Errors expose bounded safe identifiers/codes and no raw exception, host, credential or private path.

A snapshot contains `apiVersion`, identity, `configurationRevision`, `generation`, `nextRequestId`, `cursor`, `sampleClock`, `serviceHealth`, capabilities, and state. State has separate fields for `desired`, bounded `pending`, `lastSuccessfulSend`, `lastOutcome`, `externalControl`, and `observation`. Missing evidence is represented explicitly as tagged `unknown`, never fabricated false/disconnected or a successful send. A successful health check changes service health only. The observation contains its own evidence time/age, unrelated to snapshot creation time. External control is `unknown`, `controller`, or `external`, with explicit evidence or unknown. Desired power/brightness remain separate from observed power/brightness.

Pending is capped at an advertised finite bound. `lastSuccessfulSend` retains the last known transport result through later failures. A partial operation records the known completed sub-operations and uncertain remainder using bounded typed operation IDs. An error occurring after a send must not claim `priorEffects:none`.

## Bounded replay and generation validation

Retain Pixoo's server-issued epoch/sequence design. Authenticate and authorize before replay lookup; revocation blocks old cached results too. Validate the request schema, registered target and resource bounds before admission. The reference state includes `epoch`, `nextSequence`, bounded cached receipts with canonical request bodies, current configuration revision/generation and admission capacity.

For a known request identity, a structurally identical typed body returns the original receipt without another execution, including original failures. A changed body returns `request-conflict`. Object key order is immaterial; arrays retain order. An older uncached sequence returns `request-expired`, never new execution. A different epoch returns `request-expired`. A future sequence returns `request-order`. Admission reserves exactly the advertised next sequence atomically. Concurrent contenders cannot both reserve it. A repeated in-flight identity joins the original result; it never starts another write. Retain the existing Pixoo limit of 256 completed receipts as the v1 default and advertise limits.

Once identity reservation succeeds, semantic rejections such as revision conflict are retained as that request's receipt. A capacity rejection before reservation consumes no identity. Document this order and test it so implementations agree.

For a newly admitted request, check expected configuration revision and generation before changing desired state. Check generation again immediately before each queued side effect. A superseded queue entry returns cancelled/stale-generation without starting another write. If prior sub-operations already sent, cancellation reports those prior effects. Replaying a historical receipt may report a former generation but never reactivates it. A reconnect only reads snapshot/feed; it does not resubmit commands, reset ownership or start effects.

## Snapshot and feed

Cursor is `{epoch,sequence}` in a separate namespace from request IDs and generation. A feed envelope is `{apiVersion,kind:"change"|"resync",cursor,snapshot}`. Full snapshots in each event keep v1 application/recovery simple and bounded. Use 32 retained events as the default compatible with Pixoo; declare actual limits.

A retained cursor returns only later entries in order. An invalid, unknown-epoch, expired or future cursor returns one authoritative `resync`, without replaying effects. Clients replace their projection on resync and ignore duplicate sequence values within an epoch. An epoch change requires replacement, not sequence comparison. Service heartbeats are transport liveness only and never observations. Streams have a finite connection/backpressure bound and disconnect slow clients; reconnect follows the same resync rule.

## Machine authentication and bounded admission

The native endpoint uses an independently provisioned opaque machine credential mapped to principal, permitted configured devices and read/control scopes. It does not accept browser edit tokens or rely on Origin absence as authentication. When Origin is present, retain the owning server's existing Host/Origin/Fetch-Metadata protections. Never weaken browser checks to allow machine access.

Bind loopback by default. Same-machine Windows/WSL routing is explicitly configured by the owner and does not grant broad LAN listeners or remote clients. Device controllers may still reach their configured LAN hardware. Machine destination configuration is private deployment configuration, never a tool argument. Credential rotation supports an explicit bounded overlap or immediate revocation, followed by old-credential rejection. Revocation applies before cached responses and terminates or reauthorizes active streams.

Bound request body size, total in-flight requests, authentication waits/timeouts, queue size, replay cache, feed history and stream clients. V1 advertises finite bounds, with existing Pixoo defaults where shared: 64 KiB request JSON, 32 admitted requests, 256 receipts, 32 events and 16 streams. These are protocol maximums/defaults to document, not a requirement to add a server now. Resource-limit failures occur before an effect. Fixtures use synthetic credential status and scope, never real secrets. HTTP mapping is 400 invalid, 401 unauthenticated, 403 forbidden, 404 unknown registered device, 409 conflicts/stale generation, 410 expired identity, 422 unsupported operation, 429 admission capacity, 503 temporary service failure. Device implementation may map its existing API separately; this mapping applies to the new machine contract.

## Renderer clock and metadata

Renderer metadata contains `profileId`, `profileVersion`, `rendererEpoch`, `generation`, `clock:{domain:"controller-monotonic",epoch,sampledAtMs}`, optional `deadlineMs`, and `updateOutcome`. Finite monotonic numbers use milliseconds and must be nonnegative. A timestamp is comparable only inside its named clock epoch. Consumers compute remaining duration as `max(0, deadlineMs - sampledAtMs)` then subtract their own elapsed monotonic duration since receipt. They never subtract controller time from browser/other-process time. Replayed historical events do not create fresh elapsed estimates; retrieve a current snapshot. Without a fresh compatible clock sample, render timing is unknown.

Device profiles own Pixoo frame and Nanoleaf zone/timeline payload schemas, bounded payload sizes and compatibility. The common metadata references a concrete immutable profile version; unknown profiles are explicitly unsupported, not interpreted as a generic RGB timeline. Profile metadata is useful without implementing exact previews. Update outcomes distinguish accepted/pending/sent/partial/failed/uncertain/cancelled with the same transmission-only evidence limit. Browsers may draw an estimate but never schedule physical effects. Preserve Nanoleaf task/effect epochs and Pixoo mode generations; this contract does not redefine their timing.

## Moments (API 1.1)

A moment is a short, hub-decided presentation request ([ADR 0006](decisions/0006-hub-moments-and-interludes.md)). One device plays it and then returns to what it shows now. The hub sends a semantic intent. The device owns translation, precedence, timing and the return to its base. Nothing in API 1.1 carries frames, raw protocol, device geometry, titles or other private text.

### Negotiation

API 1.1 is opt-in:

- A snapshot or feed read names the version it wants with `apiVersion`, which is the `apiVersion` query parameter over HTTP. A read without it is served at 1.0, so today's 1.0 readers never receive a 1.1 shape.
- `negotiateApiVersion` serves the highest version the controller has that has the same major and is not above the request: 1.7 gets 1.1, and 1.1 gets 1.0 from a controller that negotiates but serves only 1.0. Another major or a malformed value such as `1.01` is `invalid-request`. The client validates the answer against the schema of the version it received.
- A controller that serves 1.1 accepts the signal. A controller that serves only 1.0 may reject it as an unknown read parameter, whatever contract package it is built with: the Nanoleaf controller and the local controller host both answer `invalid-request` to anything but their declared parameters. A client that gets `invalid-request` for a versioned read therefore treats the controller as 1.0-only and reads again without the signal. It sends no moments to that controller.
- A client sends a moment only after it has read a 1.1 snapshot that declares `moments` supported.
- A 1.1 controller keeps accepting 1.0 requests. Both envelopes share one ticket sequence, and each receipt carries its own request's API version.
- A 1.0-only controller rejects a 1.1 envelope as `invalid-request` before admission, without reserving a ticket.
- 1.1 snapshots and feeds use `snapshotV1_1` and `feedV1_1`. A 1.1 controller serving a 1.0 reader uses `downgradeSnapshot`, which omits the `moments` capability, `state.moment` and pending moment entries, and reports a 1.1 `lastOutcome` as `unknown` instead of misrepresenting it. A 1.0 feed carries the downgraded snapshots.

### Command and capability

`{kind:"moment", momentId, mood, palette?, durationMs, priorityClass, coversStatus, start}`:

- `momentId`: a neutral ID derived from the triggering event. The same moment sent to several devices keeps the same ID.
- `mood`: a neutral ID that the device declares. `palette` is optional: 1 to 8 `#rrggbb` colors that the device may approximate or replace with its own preset for the mood.
- `durationMs`: an integer from 1,000 to 300,000.
- `priorityClass`: `event` for a moment that a rule triggers, or `flourish` for one that an agent proposes.
- `coversStatus`: permission for the moment to play over status presentation. It is true only for event kinds in the owner's interrupt set, so a `flourish` must set it to false. The flag never stops a moment from playing over content.
- `start`: `{domain:"controller-monotonic", epoch, atMs, toleranceMs}`, described below.

The `moments` capability is `{supported:false}` or `{supported:true, moods, maxDurationMs, coversStatus}`:

- `moods` lists 3 to 64 unique IDs and must include the core moods `celebrate` (pull request merged), `setback` (CI failed) and `reminder` (meeting).
- `maxDurationMs` is the device's own limit, within the contract range.
- `coversStatus` says whether the device can play a moment over status presentation. A device that cannot still accepts moments with `coversStatus:true`, and plays them only over content.

1.1 capabilities always list `moments`. The Tidbyt and LIFX hosts stay on API 1.0 until their own interlude stories. A host that serves 1.1 before then declares `moments` unsupported.

Admission applies every 1.0 rule first: authentication, schema, target, ticket, capacity, configuration revision and generation. A mood the device does not declare, or a duration above `maxDurationMs`, fails with `unsupported-capability`. An accepted moment does not advance the configuration revision, because it changes no desired configuration. Concurrent edits therefore do not conflict with it.

### Start time and clock domain

The contract compares times only inside one controller's monotonic clock epoch. `start` is expressed in the receiving controller's clock:

- The hub already reads a snapshot before every command. It computes `atMs` as the snapshot's `sampleClock.sampledAtMs`, plus its own monotonic time elapsed since it received that snapshot, plus any lead it wants. It sets `epoch` to that `sampleClock.epoch`.
- Choreography gives each device its own `atMs` for the same hub instant. Start times are best effort, and no device synchronization is claimed.
- When the writer takes the moment, it drops the moment as `moment-missed` if its clock epoch differs from `start.epoch`, if its clock is more than `toleranceMs` past `atMs`, or if `atMs` is more than 60,000 ms ahead. `toleranceMs` is at most 60,000.
- The writer checks lateness again while the moment is scheduled. If its clock is more than `toleranceMs` past `atMs` when it next handles anything, for example after a stall, it drops the moment as `moment-missed` before acting on that event, instead of playing it late.
- A moment that misses its window is dropped, not queued. A late delivery after a hub outage therefore never plays.

### Precedence and return to base

The device-neutral presentations are `status` (Nanoleaf Work, Pixoo Monitor), `content` (Nanoleaf Free, Pixoo Media) and `quiet` (Nanoleaf Quiet). The device-neutral alerts are `attention` and `failure`; on Nanoleaf these are yellow and red task alerts. Each device story owns its exact mapping.

The device writer plays at most one moment at a time. For each moment that reaches it, in order:

1. A `momentId` among the device's recent moment IDs is dropped as `moment-duplicate`. The device remembers at least the last 64 IDs of this clock epoch, including dropped ones.
2. A moment outside its start window is dropped as `moment-missed`.
3. The moment is dropped as `moment-blocked`, not deferred, when:
   - the device shows `quiet`;
   - the device shows `status` and the moment's or the device's `coversStatus` is false, or an alert is active; or
   - it is a `flourish` and an `event` moment is scheduled or playing.
4. Otherwise it replaces any current moment, which ends as `superseded`. It is scheduled until `atMs` and then plays for `durationMs`.

A current moment ends in one of four ways:

- `completed`: its duration has elapsed.
- `preempted`: an `attention` or `failure` alert while the device shows `status`. Alerts do not pre-empt or override `content`.
- `superseded`: a newer moment replaced it.
- `interrupted`: any explicit command, including a mode change.

When a moment ends, the device shows its base as it is *now*, including any status changes made during the moment. It never shows a snapshot saved before the moment. No moment changes the selected mode.

A delivered moment no longer depends on the hub. It ends on the device's own clock, and status presentation continues while the hub is down. A restart starts a new clock epoch: nothing resumes or replays, the moment memory starts empty, and the earlier moment's requests expire with the old ticket epoch.

### Evidence

Receipts keep their transmission-only meaning:

- A moment that fails a check in the list above, or reaches its start too late, gets a `failed` receipt with `moment-duplicate`, `moment-missed` or `moment-blocked`. These failure codes exist only in 1.1 receipts. A moment dropped at its scheduled start was current but never played; it records no ending, and only its receipt reports `moment-missed`.
- A moment that starts gets `sent` for its start transmission.
- A scheduled moment that ends before starting gets `cancelled`, with no prior effects.

The 1.1 snapshot adds `state.moment`:

- `current` is `none`, `scheduled` (with `startAt`, `toleranceMs` and `durationMs`) or `playing` (with `endAt`). It carries the moment and request IDs, mood, priority class and `coversStatus`.
- `last` is `none` or the most recent moment that ended, with its `ending` and `endedAt`.

Instants use `{domain:"controller-monotonic", epoch, atMs}` and follow the same clock rule as the renderer metadata. The hub's moment log reads endings and pre-emption from this state and the feed.

The `moment` reference operation replays one device's writer order: deliveries, ticks, alerts, base changes, mode changes, explicit commands and restarts. For each event it returns what the device shows, any receipt changes and any ending. It assumes each start transmission succeeds; a real device reports its actual transport outcome through the ordinary receipt fields. The reference defines decisions only, not rendering, the device's mood presets or the hub's rules, budgets and quiet hours.

## Compatibility and distribution

Version `1.1.0` contains the schema, fixture corpus, documentation and consumers in one archive. Its manifest names the schema draft, the served API versions `1.0` and `1.1`, fixture format `1`, the artifact version and file hashes. The released `1.0.0` archive and its receipt stay unchanged under vendor/. The Device MCP 1.0.0 package keeps bundling it, even though the workspace builds against the 1.1.0 source. Record the immutable source commit externally with the archive checksum, avoiding a self-referential committed checksum. Separate repository consumers pin version plus SHA-256 and verify before import. Publish a private release asset or an authenticated immutable artifact from that commit when a dependent deliverable needs it. No worktree-relative dependency, mutable branch fetch, public package publication or private database import is acceptable.

Before the second repository depends on the artifact, record its actual artifact location/checksum and supported consumer combinations in a compatibility matrix. A plan alone is not a delivered distributable dependency. CI exercises TypeScript on Node 24 and Python on the supported Nanoleaf version, established from its live CI. Unsupported API major/minor/profile versions produce an explicit compatibility error before commands. Because v1 schemas reject unknown fields, even additive wire fields require an explicitly supported new API minor and compatible negotiation. New required fields, changed meanings or removed operations require a new major. Package patch versions may fix documentation/tests without changing accepted wire behavior.

Each controller privately owns its database. Cross-process consumers use the authenticated API or versioned artifacts. They never open a Windows-owned SQLite database from WSL concurrently. State-owner migration remains a separate issue.

## Shared fixture inventory

Use one JSON corpus. Each case names a pure operation, input state/request and exact expected output, plus schema-valid/schema-invalid classification where useful. Both language runners must process every case ID and compare identical output. Required semantic cases:

1. Ordinary light explicitly rejects media/frames while power succeeds.
2. Registered device succeeds; raw IP/URL/path/reset/raw-command fields fail strict schema.
3. All capability flags false is valid; absent required capability declarations fail.
4. Brightness -1, 101, fractional and unsafe-integer counters fail in both languages.
5. Missing observation is unknown even when service health is ready.
6. Heartbeat/snapshot sampling leaves observation age/evidence unchanged.
7. Queued desired brightness differs from last sent/observed brightness.
8. Partial transport reports prior confirmed transmission; uncertain timeout reports possible effects.
9. Exact duplicate, including reordered object keys, returns original receipt and execution count zero.
10. Same identity/different payload returns conflict, including an in-flight duplicate.
11. Evicted old sequence and previous epoch return expired; future sequence returns order error.
12. Two clients with one advertised identity admit at most one command; loser receives conflict.
13. Stale configuration or generation rejects before effect. Retired generation at dequeue cancels.
14. Generation changes after one sub-operation preserve known prior effects.
15. Old cached success returns historical receipt without restoring generation/ownership.
16. Retained cursor returns later snapshots; expired/future/different-epoch cursor returns full resync.
17. Reconnect and snapshot reads produce zero command effects and no ownership change.
18. Missing/invalid/revoked credential rejects before replay; browser token does not qualify.
19. Read-only principal may read but cannot command; device scope cannot command another configured device.
20. Rotation overlap accepts only declared credentials; revoked stream authorization fails.
21. Queue/in-flight/body limits reject before reservation/effect according to documented ordering.
22. Different process monotonic origins yield the same remaining estimate from sampled duration.
23. Different clock epochs, missing samples, stale replay sample and unknown renderer profiles produce unknown/unsupported instead of negative/fabricated timing.
24. Compatible version accepts; unsupported wire/profile versions reject before admission.
25. Extra prompt/title/transcript/tool/path/credential fields fail every common envelope.
26. Identical source fixtures run in both languages and packaged smoke imports succeed outside the checkout.

API 1.1 adds these cases:

27. Moment commands, `moments` capabilities, 1.1 receipts, snapshots and feeds validate. Short or long durations, oversized tolerances, malformed palettes, a flourish that covers status, a missing start, another clock domain, frames, raw commands, titles and text moods fail. 1.0 definitions reject every 1.1 shape.
28. A 1.1 controller queues a moment without advancing the configuration revision. It applies stale revisions and an unsupported mood or duration first, accepts a duration at the device limit, and leaves status cover to the writer. It accepts 1.0 and 1.1 envelopes on one ticket sequence, including in one batch, and replays a reordered moment request. A 1.0-only controller and an unknown 1.2 envelope reject before reservation.
29. Reads without a version get 1.0. A newer minor gets the highest served version, another major or a malformed value is invalid, and a 1.0-only controller answers 1.1 reads at 1.0.
30. A moment returns to the current base after status changes during it, starts on schedule and expires after its duration.
31. An alert pre-empts a scheduled or playing moment on status, and an existing alert blocks one. Alerts neither pre-empt nor block over content.
32. Quiet blocks a moment, and so does status when the moment or the device cannot cover status. A device that cannot cover status still plays the moment over content.
33. Late delivery, another clock epoch, an over-long lead and a start reached after its tolerance are missed, including when the next event is a delivery or a command; a start within tolerance plays.
34. A duplicate ID is ignored while playing and after ending, and the device remembers the last 64 IDs.
35. A newer event supersedes a moment, an event supersedes a flourish, and a flourish supersedes a scheduled flourish, which is then cancelled. A flourish during an event is blocked.
36. A mode change or an explicit command interrupts a moment; a scheduled moment is then cancelled.
37. With the hub down, a playing moment ends on the device clock, and a late delivery after recovery is missed.
38. A restart replays nothing, drops a scheduled or playing moment without a new receipt or ending, and forgets the moment memory.
39. The 1.0 view of a 1.1 snapshot omits moment content, reports a 1.1 outcome as unknown and keeps a 1.0 outcome.

Schema checking proves payload shape. Pure semantic fixtures prove the reference algorithm. Device adoption tests must later run equivalent cases against real owning services/queues and authenticate through their actual HTTP layer. This issue must report that remaining consumer adoption explicitly.

## Artifact verification matrix

| Consumer | Runtime | Verification |
| --- | --- | --- |
| TypeScript reference | Node 24, Ubuntu | Strict Ajv schema validation, 327 shared cases (190 schema, 137 semantic), immutable input checks, emitted receipt, moment-state and 1.0-view validation, and archive import |
| Python reference | Python 3.12 and 3.14, Ubuntu | jsonschema 4.19.2, the same 327 cases and archive import |
| Nanoleaf controller | Adoption belongs to codex-nanoleaf #28 | Pin a published archive and checksum; run owning API/queue tests |
| Pixoo controller and MCP | Adoption belongs to the linked integration work | Pin a published archive and checksum; run owning API/queue tests |

Native Windows is outside the current CI support matrix. Windows development
uses Linux runtimes inside WSL; installed WSL/client acceptance remains separate.
Published artifact bytes and their historical verification receipts stay intact.

Run `npm run test:package` to build and check the distributable. The generated
manifest hashes every shipped source, schema, fixture, compiled module and guide.
The archive and SHA-256 sidecar are under artifacts/. The delivery record must
bind their checksum to the immutable source revision and actual private release
asset before a dependent repository adopts them. Current reference checks do not
claim either controller has adopted or enforced the contract. No controller serves
API 1.1 yet. Nanoleaf [#158](https://github.com/jimmie-potts/codex-nanoleaf/issues/158)
and Pixoo [#92](https://github.com/jimmie-potts/divoom-app-upgrade/issues/92) own the
first moment adoptions.
