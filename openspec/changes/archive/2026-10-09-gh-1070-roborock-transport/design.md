## Context

See `proposal.md` for motivation and `specs/roborock-read-transport/spec.md` for the behavior contract. This change needs a design because it adapts encrypted device traffic, handles credentials and adds a third-party MQTT client. The runtime already supplies SDK diagnostics and profile 2.0 errors; it does not yet serve this transport.

Protocol reference: MIT ioBroker.roborock at `ce998f6980b9928af800d8083cbe794f3b93ca97`. Use its framing, signing and map primitives, with synthetic vectors and attribution. Its adapter orchestration is unsuitable here: it discovers devices, chooses cloud fallback, retries login and logs response content. None of that is adopted. September Python observations remain separate exact-device provenance, not test fixtures or current qualification.

## Goals / Non-Goals

**Goals:** one lazy, serialized read transport for one explicitly configured robot; a private reusable session; source-qualified framing, account setup and map decoding; a stable interface for #376.

**Non-Goals:** runtime registration, collection scheduling, public schemas, SQLite, browser integration, live account setup, physical compatibility proof or any control operation. No discovery, protocol auto-detection or automatic service fallback.

## Decisions

### Isolate protocol access behind typed observational methods

The package exports its root entry as `@jimmie-potts/roborock-transport`. Callers use status, consumables, summary, one record, rooms and current-map methods, each with optional internal trace and cancellation context. Successful results retain observation time and protocol values; failures carry `ErrorBody` from the existing registry. Private session material is never part of a read result. The final operation encoder validates exact method, route and fixed parameters even for an untyped caller. An allowlist only in the public wrapper would leave connection paths able to issue unintended RPCs, so the byte-producing boundary owns the guard.

Local V1 reads go to a validated numeric configured IP on TCP 58867. MQTT is used only for `get_map_v1`, with an exact configured robot topic. No wildcard discovery subscription is needed. Local CONNECT/CONNACK frames are protocol control messages, not RPCs; no `app_get_init_status` or `get_prop` is introduced. Separate synthetic vector tests exercise framing and the six RPC encodings.

### Reuse a maintained MQTT client and Node protocol primitives

Use pinned MIT `mqtt@5.16.0` for MQTT framing over the configured TLS broker, and Node crypto/zlib/net for device framing and map decoding. Implementing an MQTT client here would create unrelated protocol work. Disable automatic reconnect, resubscription, offline publish queues and telemetry; lifecycle belongs to the read transport. Bound the incoming MQTT packet length before body allocation as well as the decoded device frame. TLS certificate validation remains enabled. Direct MIT `debug@4.4.3` checks whether the dependency packet namespaces are enabled before constructing a client; enabled packet logging is refused without changing environment or debug settings. A consumer check verifies that MQTT and mqtt-packet resolve the same debug module. Synthetic tests inject a client or use a loopback peer; production construction never contacts a broker.

V1 publish frames carry version, message ID, random value, seconds timestamp, protocol, payload length and CRC32, with AES-128-ECB payload encryption. Local TCP adds a four-byte length prefix; control frames use their distinct 17-byte header without publish length/CRC. The MQTT map reply uses the outer V1 envelope, protocol 301, a 24-byte map envelope with a little-endian correlation ID, inner AES-128-CBC with the request's 16-byte nonce and zero IV, then gzip. Validate lengths before slicing, CRC before decryption and correlation before decompression. Limit decompression during inflation, not by checking an already allocated result.

### Keep account setup separate from routine reads

An owner-run interactive entry prompts for email and code; command arguments carry no account credentials or code. It reads an explicit private target configuration and sends only the pinned v4 email-code/key-sign/login flow. Account home lookup selects the exact configured device ID, matches its product/model and saves only routine-session fields. It never scans the LAN, changes a robot, downloads product images or reads obstacle photos. The initial account token and Hawk home credentials are transient setup data, excluded from diagnostics and the persisted routine session.

The private session contains the selected device identity/model/local key and necessary MQTT RRIOT fields. Validate the selected V1 model/protocol explicitly; refuse unsupported models. Session loading does not refresh or log in. The device target is immutable for one transport instance. Inputs reject symlinks and unsafe file modes; a private parent directory and atomic exclusive file creation protect new credentials. Store no credentials under a Git checkout, including ignored scratch. Pre-rename failures preserve the previous valid session; never clear one to repair authentication. A rename followed by failed directory syncing reports that replacement happened but durability is unconfirmed, without automatic retry or rollback. Descriptor anchoring covers ordinary Git/worktree markers and pathname substitution, with a designated non-repository private directory and one setup writer; it does not claim protection against arbitrary same-UID filesystem changes or externally assigned worktrees without markers. Numeric address validation cannot identify every directed broadcast without a subnet prefix.

### Bound and retire one serialized read owner

Allow one active read and at most eight waiting reads. An explicit per-read deadline includes queue time, connection, response and any permitted retry; default 10 seconds, maximum 30 seconds. At most two attempts, with a capped 250 ms backoff for connection/disconnect failures only. Authentication, malformed responses, unsupported content and cancellations are not retried automatically. A new explicit read after failure is separate from an automatic retry.

Every request uses a fresh correlation identity and map nonce; IDs do not wrap into an active request. Close the per-attempt socket/client after its result. Cancellation retires work before a queued request reaches the sender; stop aborts active and waiting work, closes subscriptions/sockets and fences completion by transport generation. A late callback cannot deliver a reading or open another connection.

Local publish frames are bounded by their 16-bit payload length; JSON responses are capped at 64 KiB. MQTT packets and encrypted map bytes are capped at 1 MiB, with at most 64 inbound MQTT packets per attempt; decompressed maps at 2 MiB. The observed historical map size fits these bounds, but that is not a promise for every home. Refuse content beyond these limits rather than truncate it. No raw map enters a profile envelope.

### Map failures and diagnostics once at the boundary

Use `invalid-request` for unsafe/malformed configuration or record arguments; `forbidden` for a rejected final RPC; `unauthenticated` for account, broker or connection authentication refusal; `unsupported-capability` for a model/protocol/map format or raw-map size outside this transport's documented decoding capability; `unavailable` when a disconnect, deadline or unusable vendor reply leaves no trustworthy observation; `capacity` for the pending queue; `cancelled` for abort/stop; `internal` only for an unexpected owner failure. A malformed response is never retried automatically, even though the registry's fixed `unavailable.retryable` flag permits a later explicit retry. Do not use profile-only `invalid-message` or the profile's 256 KiB `too-large` code for raw vendor bytes. This preserves registry meanings without adding a shared-contract change.

Use injected SDK logger/trace services with no-op defaults. `DeviceAvailability` summarizes repeated failures; device-call spans retain internal parentage and never put trace headers in vendor/device traffic. Records contain registered operation/code/count/duration fields, no address, account material, response body or raw bytes. Telemetry failure cannot fail a read. Synthetic tests scan outward results, records and spans for credential sentinels.

## Risks / Trade-offs

- [Undocumented vendor protocols can change] → pinned source provenance, explicit V1 model support and synthetic vectors; retain current-firmware uncertainty for the authorized comparison in #376.
- [Upstream orchestration can issue controls or expose secrets] → adapt primitives only, independently test the final sender and exclude adapter runtime, discovery, photo management, automatic login and logging.
- [A hostile compressed map can exhaust memory] → cap framing and inflation before allocation, fail the read and retire its connection.
- [Fresh sockets add connection cost] → serialized bounded requests simplify cancellation and correlation; measure only if an observed issue warrants reuse.
- [Source-qualified setup may still fail against the actual account] → fake endpoints prove requests and refusal behavior; actual login is an explicit owner step, never a hidden fallback.

## Migration Plan

This story introduces unregistered source code and changes no installed state. #376 consumes the merged interface and owns integration. There is no account migration or installation step here. Removal before integration consists of removing this unused package and its check wiring; existing runtime behavior is unchanged.
