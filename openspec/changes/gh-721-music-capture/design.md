## Context

The current SDK offers `RemoteParticipant.openEndpoint`, a connection-bound handler with a five-second publication deadline and immediate local closure notification. Coding workers already use a fixed-source credential with no ordinary scopes. The core has `CorePart` lifecycle hooks, transactional state and tracked operator admission. See proposal.md for the capture proof and source scope.

This change needs a design because it crosses the native process, authenticated SDK edge and durable core, and because audio callback timing and capture permissions affect failure behavior.

## Goals / Non-Goals

The first source result is an explicit Music-only capture session and bounded measured features. It creates no light participation policy. Playback metadata, track position and speaker controls retain their playback owner. Microphone support and optional completed musical analysis remain in the owning issue and are not falsely advertised by this slice.

## Decisions

### Native capture and analysis

Keep the native helper in `apps/music-producer/native` and its TypeScript SDK wrapper in the same application. A host process is required because the selected runtime is a Linux container. A new runtime module would not grant that container access to macOS audio. Whole-system capture and virtual drivers add collection scope without evidence that the tested Music-only tap needs them.

The helper uses an inclusive Music-process tap and unmuted private aggregate. Only `--capture` opens audio. The callback owns bounded analysis state and never performs JSON serialization, file/network I/O or a blocking publication. A bounded transfer hands derived windows to the control loop. Standard input closure and SIGINT/SIGTERM retire the tap and aggregate. Changing route/format or losing the selected process terminates the current source instead of silently changing inputs.

Portable synthetic signal tests run independently of Core Audio. The macOS adapter is compiled separately. A stable executable identity and audio usage description are part of source packaging; actual permission/signing behavior remains installed qualification.

### Source and bus contracts

Local helper output is a closed, versioned derived-value record, parsed before the wrapper uses it. The wrapper adds the core-issued session generation and existing profile 2.0 envelope. No native process identifier, device address, track metadata or PCM is transmitted.

Use capture endpoint registration, work, progress, features and loss families. Uncoalesced `progress` observations report started/stopped/failed transitions; `features` are independent occurrences coalesced to one in-flight publication and one pending value. Endpoint registration advertises only implemented Music input capability. Registration itself does not start capture.

The gateway gives one `music-producer` role, fixed to `bunny/parts/music-producer`, an endpoint grant for those families and no ordinary scopes. Reuse existing SDK authentication, connection-bound capability and closure handling. Do not widen `ingest` or implement another network protocol.

### Capture authority and outcomes

A `MusicCapturePart` in the core owns the capture record, generation and operation responsibility. Operator start/stop uses the existing action dispatcher and admission checks. A durable start record precedes the endpoint request. The producer validates the request and source before beginning; a received start report establishes actual source activation. A lost reply after dispatch remains uncertain. Fixed registered error codes distinguish unsupported input, permission refusal, source loss, invalid data and internal failure where evidence permits.

Stopping immediately fences pending frames for that generation and attempts bounded native teardown. Report stopped only after observed clean teardown; otherwise report unavailable or uncertain. A definitive late lifecycle report can resolve an uncertain operation under ADR 0012 without restoring a retired generation. Work already performed is not undone. SDK disconnection stops the native helper locally and retires the endpoint; the gateway tells the core which endpoint was lost. Restart recovery retires capture and resolves unfinished responsibility without replay. Light writers are not involved.

### Timing and bounded storage

Use ten analysis windows per second for the first level/band path. Native sequence advances for every completed window, including windows superseded under pressure. Native monotonic start, end and emission times share one clock. Their differences reveal window duration and local buffering without comparing Mac host ticks to Linux clocks. The native code converts host ticks with the actual timebase into `mach_continuous_time` milliseconds. Current Node 24 uses that same clock through libuv on macOS. Before capture the wrapper brackets a harmless native `--clock` reading with `process.hrtime.bigint()` and refuses a mismatched origin. Audio host timestamps are mapped from absolute to continuous time; a changed suspend offset invalidates the partial window. See [libuv Darwin clock](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/darwin.c#L56).

At every actual publication, source age is `Node monotonic now - native window end`, so stdout and wrapper queue delays count. Reject negative age or age above 250 ms. Convert the window end to an integer source wall instant using the current paired wall/monotonic reading. The payload names `observedAtMs` and `validUntilMs`; occurrence envelopes never carry `expiresat`. Set `validUntilMs = observedAtMs + 400`, reserving 100 ms of the 500 ms maximum age for clock skew. The core refuses a source instant over 100 ms in its future or a frame at/past `validUntilMs`, in addition to generation/source/sequence checks. It expires a current feature by the earlier of that payload deadline and its own receipt-monotonic deadline. A fresh envelope never renews the source window.

This first same-Mac/container source path requires absolute wall-clock skew of at most 100 ms. At registration, the wrapper brackets the core's SDK reply timestamp with its local send/receive wall readings and requires the whole possible offset interval within 50 ms. Both participants monitor wall versus monotonic advancement from their session anchors and invalidate capture on a drift or jump above 25 ms each. The initial 50 ms plus those two 25 ms budgets preserve the 100 ms bound. This is a declared clock assumption to qualify on the selected installation, not a guarantee for independent hosts. Tests cover delayed stdout, delayed publication, future dating, skew limits, wall jumps and rate-limited recovery. These timestamps do not establish audible speaker position; route-specific delay qualification is separate.

The core's existing tracker records published state and occurrences privately. This design does not create a history exception or expiration policy. Only derived windows admitted to publication enter that history; PCM never does. The ten-per-second bound limits input work, but history still grows during capture. Document that trade-off and avoid describing coalescing as a complete archive.

### Diagnostics

The SDK and gateway retain their registered decision records and trace continuity. The wrapper maps native failures once to shared error codes and fixed text. It does not log features, raw native output or credentials. A source failure logs a transition, not every missing window. Capture work keeps the requesting trace; feature occurrences use bounded session context without inventing a tracing implementation.

## Risks / Trade-offs

- Permission and synchronous Core Audio calls can outlast ordinary loops. Supervise native startup/stop with a bounded parent wait and classify a lost result as uncertain. A killed process does not prove OS cleanup; installed qualification must check it.
- Latest-value transport can drop intermediate features. Sequence gaps disclose that loss; uncoalesced lifecycle reports do not share the replaceable queue.
- Ten windows per second supports the first level effect but is not a guarantee of precise beat synchronization. Physical evidence may justify a revised cadence or scheduling policy.
- A signed helper may receive different permission treatment than the disposable probe. Keep a stable source identity and qualify the packaged candidate before installing automatic startup.

## Migration Plan

Add only source, schemas, tests and the disabled-until-explicit-start producer path. Existing callers and device modules retain their behavior. New private capture tables are additive and contain no PCM. Review schema/credential changes independently, and run disposable loopback acceptance before merge. The selected installed pilot owns credential provisioning, helper identity, permission prompts, runtime upgrade and physical trials. No installation runs as part of this source slice.
