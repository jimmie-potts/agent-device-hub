## Context

Tidbyt owns its 64×32 renderer, backend connection and serialized display writer ([architecture](../../../docs/architecture.md#ownership)). The official cloud comes first; a later Tronbyt connection must reuse the same renderer and queue ([Tidbyt guide](../../../controllers/tidbyt/README.md)). The push qualification on #16 established the cloud facts below. The user chose three options during delivery: a controller-local display profile over a shared contract change, an in-process library over a loopback API, and a dependency-free lossless encoder over an npm WebP dependency.

Qualified cloud behavior, from the [#16 comment](https://github.com/jimmie-potts/agent-device-hub/issues/16#issuecomment-5789545093):

- `POST https://api.tidbyt.com/v0/devices/{device}/push` with `Authorization: Bearer <key>` and `{deviceID,image,installationID,background:true}` returns 200 `{}`. The installation joins the rotation and does not interrupt the current app.
- `GET …/installations` lists pushed installations with an empty `appID`. `DELETE …/installations/{id}` removes one.
- A missing credential returns 500 `context doesn't have a UID`. An invalid token returns 401 with an expired-certificate introspection message. No rate-limit headers or 429 responses were seen, and no size limit is documented.

## Goals / Non-Goals

**Goals:** a pure renderer; a cloud connection with configured identity and a private credential file; one serialized queue that uses controller v1 admission semantics; honest outcome and evidence reporting; and fake-backed tests for every #16 criterion.

**Non-Goals:** status layout, session selection and update cadence (#19); an HTTP/MCP surface, hub registration and installation (#21); Tronbyt (#23); firmware (#24); foreground pushes; brightness or power control; any change to the shared contract.

## Decisions

### Package and module boundaries

The package is `controllers/tidbyt`, published as `@jimmie-potts/tidbyt-controller` 0.1.0, private, ESM and built with `tsc`. It depends only on the `@jimmie-potts/device-contracts` workspace. Modules:

- `render.ts` holds the frame type, strict validation and `renderFrame(frame) → WebP bytes`. It imports only `webp.ts` and has no I/O, clock, configuration or backend knowledge. A test enforces the import boundary.
- `webp.ts` is a VP8L lossless encoder. It writes no transforms, no color cache and no backward references. Each channel uses a simple one- or two-symbol prefix code when it has at most two values, and a complete fixed 8-bit code otherwise. Alpha is always 255, so it costs zero bits per pixel. Output is deterministic and at most about 6.3 KB.
- `connection.ts` defines the `DisplayConnection` interface (`push`, `readInstallation`, declared capabilities) and the `TidbytCloudConnection` implementation, which uses an injected `fetch`. It never logs or returns the key, the cloud device ID or response bodies.
- `credentials.ts` loads `TIDBYT_DEVICE_ID`, `TIDBYT_API_KEY` and an optional `TIDBYT_INSTALLATION_ID` from a file. It rejects group- or world-readable files on POSIX and never reads arguments or the environment for secrets.
- `controller.ts` holds `TidbytController`, the single queue and the snapshot projection.

Alternative considered: an npm WebP library. sharp is native and heavy, and wasm builds add a runtime dependency and initialization. The user chose the pure encoder.

### Display profile over controller v1 shapes

A display request reuses the v1 request envelope and replaces `command` with a profile command: `{kind:"tidbyt.display", frame:{width:64,height:32,encoding:"rgb24-base64",data}}`, where `data` is canonical base64 of exactly 6144 bytes. Receipts and the embedded controller snapshot are schema-valid controller v1 objects checked with `validate()`. The controller snapshot declares every v1 capability unsupported. The Tidbyt section declares the frame format and the connection's capabilities: background push supported, foreground push unsupported, installation read supported. A valid v1 command reserves its ticket through the contract's own `admit()` and is retained as `unsupported-capability`. Display requests follow the same admission order in local code: structure and frame validity (`invalid-request`), target check, body bound, epoch, cache replay or conflict, in-flight join or conflict, expired or future sequence and capacity, none of which reserve an identity. Revision and generation conflicts come after reservation and are retained. Queued requests reuse the contract's `dequeue` reference immediately before each push.

Alternative considered: a shared API 1.1 frame command. It would touch both contract consumers, the fixtures, the hub and MCP for one device. It was rejected for this issue.

The in-process caller is trusted, so there is no machine authentication step. A future HTTP surface must authenticate before admission, as the contract requires.

### Outcome classification

| Cloud result | Receipt | priorEffects | Controller effect |
| --- | --- | --- | --- |
| 2xx | sent (`completedOperations:["push"]`) | confirmed-transmission | `lastSuccessfulSend` updated |
| 401, or 500 whose body says the request has no UID | failed `unauthenticated` | none | Authentication hold. Queued and later requests fail without a network call until `reconfigure` |
| 403 | failed `forbidden` | none | Authentication hold |
| 404 | failed `unknown-device` | none | Health unavailable |
| 400/413/422 | failed `invalid-request` | none | Health degraded |
| 429 | failed `capacity` | none | Hold sends until `Retry-After` (seconds or HTTP date), default 60 s, capped at 15 min. Queued requests wait and are not failed |
| Other 5xx | uncertain `uncertain-result` (`uncertainOperations:["push"]`) | possible | No replay |
| Timeout, abort or response lost after dispatch | uncertain | possible | No replay |
| Connection refused, DNS failure or other definite pre-send failure | failed `transport-failure` | none | Health unavailable |

Uncertain results are never retried automatically. A duplicate submission returns the retained uncertain receipt.

### Queue, cancellation and bounds

The queue holds one write at a time, in FIFO order. `maxPending` and `maxInFlight` are 8, receipts are capped at 256, the request body at 64 KiB and the push timeout defaults to 10 s. `cancelPending()` advances the generation and immediately settles queued entries as `cancelled`/`stale-generation`. The dequeue check still guards every push, and a write already in flight completes and reports its own result. `close()` aborts the in-flight write, which reports uncertain, and cancels everything else. `reconfigure()` swaps the connection, advances the configuration revision and generation, clears authentication and rate-limit holds, and resets installation evidence to unknown. Health comes from write and read results. `refresh()` reads the installation once; an authentication failure there also sets the hold. It never resubmits commands, reserves identities or changes ownership.

### Evidence

The embedded controller snapshot keeps `observation`, `externalControl` and desired power, brightness and mode at `unknown`, because the cloud reports none of them. The Tidbyt section reports pending display tickets, holds, installation evidence (`present` plus clock and `evidenceAgeMs`, from the last successful read) and `visible: {status:"unknown"}`. Installation evidence ages from its own read time. A failed read leaves the earlier evidence in place, marks health unavailable and never creates new evidence.

## Risks / Trade-offs

- Undocumented cloud limits → classify 429/5xx conservatively. Physical acceptance under #21 remains the visible check.
- Expired-certificate 401s may also appear for valid keys if Tidbyt breaks further → they surface as `unauthenticated` with a hold, not as retries.
- The fixed 8-bit code does not compress busy frames → the payload stays under about 6.3 KB, well within 64 KiB. Entropy coding can come later without changing the boundary.
- In-process only → hub, MCP and dashboard visibility wait for #19/#21.

## Migration Plan

None. The package is new. No state, installation or existing controller changes.

## Open Questions

None blocking. Status cadence and rotation policy belong to #19.
