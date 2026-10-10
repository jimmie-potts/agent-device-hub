# Roborock source transport

This package supplies the read-only V1 transport for Hub #1070. It is not
registered with the running application. The private workspace package lives at
`modules/roborock/transport`; the module root has no package manifest until #376
provides a complete runtime registration. This preserves the build registry’s
rule that every direct module package exports a registration. The runtime collector, private SQLite
history, module page and MCP status tool are #376 work.

The transport uses an explicit private target configuration and session. Local
status, consumables, summary, records and rooms use TCP 58867. Current-map bytes
use the explicitly configured vendor MQTT route. No local failure causes cloud
fallback. Construction and imports perform no network use. The Roborock app
remains the cleaning control surface.

The final sender permits only `get_status`, `get_consumable`,
`get_clean_summary`, `get_clean_record`, `get_room_mapping` and `get_map_v1`.
There is no generic consumer command, discovery, map switch, cleaning operation
or photo retrieval. Account setup is explicit and interactive; routine reads
load a private session without logging in again. Actual account setup and use
of the owner's vacuum require separately authorized qualification.

## Protocol provenance

Adapt only the required primitives from MIT ioBroker.roborock revision
[`ce998f6980b9928af800d8083cbe794f3b93ca97`](https://github.com/copystring/ioBroker.roborock/tree/ce998f6980b9928af800d8083cbe794f3b93ca97).
Retain its full license in `UPSTREAM-LICENSE.txt` and describe each adaptation
in the protocol record. Do not import its adapter runtime, discovery, photos,
cloud fallback, automatic login or response logging. Its model list and source
tests are evidence for adaptation, not proof for the owner's current firmware.

September Python qualification linked from #1070 observed local reads and
vendor-MQTT current maps; it did not qualify push status or historical-map
retrieval. It remains separate provenance. Every committed fixture here is
synthetic; owner maps, account material and household history stay private.

## Source validation

Use Node 24 and the commands in
[Roborock transport checks](../../docs/development.md#roborock-transport-checks).
`npm run test:roborock-transport` builds and runs the focused suite;
`test:roborock-transport:built` and `test:roborock-transport:consumer:built`
require a fresh root build. Independent Standards and Specification review
includes the credential seam, final sender and map-decompression controls.

Source validation uses synthetic peers and proves transport behavior only.
Installed setup, exact-firmware compatibility and run/map comparison remain
separate evidence; do not contact a real target to make source checks pass.

## Private setup

The owner selects a Linux private directory outside every Git checkout, including
ignored directories, with mode `0700`. Configuration and session files must be
owned by that user, have one hard link and mode `0600` or `0400`. Symlinks in
any pathname component are refused. The configuration has these exact fields:

```json
{
  "schemaVersion": 1,
  "deviceId": "<selected device ID>",
  "address": "<selected numeric private IPv4 address>",
  "broker": "mqtts://<selected official Roborock broker>:8883",
  "region": "us"
}
```

Replace every placeholder with owner-selected values. There is no default
robot or broker. Regions are `us`, `eu`, `cn` and `asia`; they select the
pinned email-code account endpoint and country. This transport supports only
`roborock.vacuum.a97` with V1 `1.0`. The returned account broker must match the
explicit configuration. No discovery or protocol probing fills missing values.

After a fresh root build, the owner runs this entry interactively:

```bash
node modules/roborock/bin/setup.mjs --config <absolute-private-config-path> --session <absolute-private-session-path>
```

Email and the six-digit code are prompted, never accepted as arguments. Setup
checks the destination before account traffic, then follows the selected v4
email-code/sign/login flow and looks up only the configured device identity.
It sends no robot RPC. The session contains only schema version, device ID,
model, protocol, local key, RRIOT `u`/`s`/`k` and broker. The token, Hawk key,
email and code remain transient. Setup is bounded to five minutes, each HTTP
request to ten seconds and each streamed JSON response to 2 MiB. It retries
nothing. Current account-service compatibility remains unverified.

Session replacement is atomic within its opened parent directory. Pre-rename
failures preserve the previous file. If replacement succeeds but directory
syncing or verification fails, setup reports replacement with durability
unconfirmed; do not retry or roll back automatically. Keep one setup writer.
Git-marker checks cover ordinary checkouts/worktrees, not arbitrary externally
assigned worktrees without markers. Descriptor checks do not provide an atomic
compare-and-replace against another process with the same UID. Address-only
validation cannot identify every directed subnet broadcast; common `.0` and
`.255` endpoints are conservatively refused.

## Consumer interface

Import `@jimmie-potts/roborock-transport`. Load the explicit configuration and
session with `loadPrivateConfig` and `loadPrivateSession`, then construct a
`createReadTransport` owner. Construction snapshots and validates the target;
it opens no connection and never signs in. There is no generic command export.

The reader provides `readStatus`, `readConsumables`, `readCleanSummary`,
`readCleanRecord(startTime)`, `readRoomMapping`, `readCurrentMap` and `stop`.
A reading is either `{ok: true, value, observedAt}` or
`{ok: false, error: ErrorBody}`. Missing vendor domain fields remain missing;
#376 owns normalization. Current maps return private `Buffer` bytes, with no
claim about geometry or map coverage. The owning module must associate map
capture time and run identity rather than infer a historical map from a late
current-map response.

Each read accepts `signal`, `timeoutMs` and an internal `trace`. The default
deadline is 10 seconds; the maximum is 30 seconds, including waiting. One read
is active and eight may wait. Connection/disconnect failures get at most one
retry after 250 ms; authentication, malformed responses and cancellation get
none. Every attempt has a new inner ID, connection and map nonce. IDs cycle
only after the previous connection is retired; map nonce verification prevents
an old map from satisfying a reused numeric ID. Stop retires active and queued
work, closes connections and prevents late successful completion.

V1 frames follow their 16-bit encrypted-payload limit. JSON replies are bounded
to 64 KiB; MQTT packets/encrypted maps to 1 MiB; decoded maps to 2 MiB during
inflation. One MQTT attempt accepts at most 64 packets. The inbound guard
checks advertised packet length before the MQTT parser sees its header. TLS
certificate validation stays enabled. Enabled credential-bearing MQTT debug
namespaces are refused without changing logging settings; the consumer check
verifies a shared direct/transitive debug instance.

Inject SDK clock, scheduler, logger and span recorder through the diagnostics
options. Repeated failures use `DeviceAvailability`; spans use
`bunny.device.call`. Records carry fixed registered metadata and never include
an address, account fields, vendor responses or raw bytes. Trace context stays
inside B.U.N.N.Y. and is never transmitted to the vendor.
