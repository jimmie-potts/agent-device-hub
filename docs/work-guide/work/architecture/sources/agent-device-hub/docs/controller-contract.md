# Controller contract v1

[Hub #4](https://github.com/jimmie-potts/agent-device-hub/issues/4) adds these contract schemas, shared fixtures and pure validators. It does not implement a controller, writer, network listener, MCP endpoint or renderer.

## Artifact layout

- packages/contracts/package.json: private versioned source artifact `@jimmie-potts/device-contracts`, version `1.0.0`, publishable through explicit artifact packaging without public registry publication.
- packages/contracts/schemas/controller-v1.schema.json: strict Draft 2020-12 envelope schemas using `$defs`.
- packages/contracts/fixtures/controller-v1.json: all language-neutral schema and semantic cases, with inputs and expected results.
- packages/contracts/src/index.ts: schema loading/export and pure admission, replay, feed and clock interpretation reference functions only.
- packages/contracts/python/agent_device_hub_contracts/: Python consumer of the identical schema/fixtures, with matching pure reference functions.
- packages/contracts/tests/: TypeScript tests consume the shared JSON cases. Python tests do the same. They must fail when expected outputs differ; merely checking fixture shape does not establish semantics.
- docs/controller-contract.md: normative behavior, HTTP mapping, privacy, adoption and compatibility.
- docs/development.md and CI: build/typecheck plus TypeScript and Python contract tests, in addition to the existing workflow checks.

Prefer schema definitions and small explicit reference functions over generated runtime frameworks. Consumers need no database or device to exercise these fixtures.

## Wire values and identity

All common objects reject unknown fields. Both consumers reject JSON nested more than 32 levels before schema validation, returning invalid-request without reserving a command. Valid v1 envelopes fit well below this bound. API version is literal `"1.0"`; contract artifact is `1.0.0`. IDs are neutral, operator-configured strings, bounded to 128 ASCII letters/digits/underscore/hyphen/dot. Labels are optional, at most 80 Unicode characters, and can originate only from explicit user input. Do not copy media/session titles or paths into labels automatically. Revision and sequence numbers are nonnegative safe integers, at most 9007199254740991, to avoid TypeScript/Python disagreement. Epoch IDs are opaque bounded neutral IDs, never clocks or credentials.

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

Discovery, snapshot and preview retrieval are reads. They cannot advance animation queues, clear notices, allocate zones or issue writes. Optional device profiles may add typed operations through separately versioned schemas and advertised compatibility. V1 has no arbitrary extension-command object or raw renderer command.

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

## Compatibility and distribution

Version `1.0.0` contains the schema, fixture corpus, documentation and consumers in one archive. Its manifest names schema draft, API `1.0`, fixture format `1`, artifact version and file hashes. Record the immutable source commit externally with the archive checksum, avoiding a self-referential committed checksum. Separate repository consumers pin version plus SHA-256 and verify before import. Publish a private release asset or an authenticated immutable artifact from that commit when a dependent deliverable needs it. No worktree-relative dependency, mutable branch fetch, public package publication or private database import is acceptable.

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

Schema checking proves payload shape. Pure semantic fixtures prove the reference algorithm. Device adoption tests must later run equivalent cases against real owning services/queues and authenticate through their actual HTTP layer. This issue must report that remaining consumer adoption explicitly.

## Artifact verification matrix

| Consumer | Runtime | Verification |
| --- | --- | --- |
| TypeScript reference | Node 24, Ubuntu and Windows | Strict Ajv schema validation, 220 shared cases, immutable input checks, emitted receipt validation and archive import |
| Python reference | Python 3.12 and 3.14, Ubuntu and Windows | jsonschema 4.19.2, the same 220 cases and archive import |
| Nanoleaf controller | Adoption belongs to codex-nanoleaf #28 | Pin a published archive and checksum; run owning API/queue tests |
| Pixoo controller and MCP | Adoption belongs to the linked integration work | Pin a published archive and checksum; run owning API/queue tests |

Run `npm run test:package` to build and check the distributable. The generated
manifest hashes every shipped source, schema, fixture, compiled module and guide.
The archive and SHA-256 sidecar are under artifacts/. The delivery record must
bind their checksum to the immutable source revision and actual private release
asset before a dependent repository adopts them. Current reference checks do not
claim either controller has adopted or enforced the contract.
