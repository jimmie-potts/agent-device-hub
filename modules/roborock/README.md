# Roborock observations

`modules/roborock` registers a read-only module for the B.U.N.N.Y. runtime,
with a React status page and the read-scoped `roborock_status` MCP tool.
The nested `@jimmie-potts/roborock-transport` package supplies the V1 transport.
The Roborock app remains the cleaning control surface.

The module uses SDK API 1.3. Its configuration names one routing `id` and two
private secret files, `target` and `session`. The target and session JSON
contracts are described below. Settings expose only the routing ID. Imports,
configuration admission and local startup open no robot connection and load no
account session. The first scheduled collection loads the named private files;
a target mismatch refuses collection into the existing archive.

The page lives at `#/module/roborock/status`. It reads `status`, `runs`, `run`
and `samples` through the shell's authenticated content API and follows the
`roborock-vacuum` family through its synced copy. Runs pages contain at most 25
records; sample pages contain at most 100 samples and 100 gaps. Cursors freeze
membership admission, while later conflicting evidence may retire sample
eligibility. Content references cannot select files, original JSON, room names
or map bytes. The single MCP contribution reads the same status projection.
The generic `device` record declares all controls unsupported.

## Observation and retention boundaries

The collector initially polls every 60 seconds outside supported cleaning or
returning activity and every 15 seconds during it. Calls and record batches are
bounded and serialized. These policy intervals do not establish push support.
The reader has a 9-second deadline within the collector's 10-second fallback
fence, so transport timeouts can report degradation before cancellation. Slow
serialized work records missed observation intervals, including status reads
that bracket a candidate map capture.
A docked `clean_time` or `clean_area` may describe the previous run; it does not
start or complete an episode. Unavailable replies and downtime create gaps,
never synthetic battery samples or inferred completion.

The runtime owns one private SQLite connection on its ext4 state root, outside
Git and Windows mounts. It uses exclusive ownership, WAL and FULL durability.
Original successful parsed JSON, normalization version, observation ID and
collection generation stay private. This is parsed-value retention, not a
claim to preserve wire bytes. Vendor record IDs identify retained runs; public
start/end instants use milliseconds. Summary subsets and empty replies do not
delete history. Partial records preserve previously known measurements with
separate private evidence times; contradictory inputs retain their versions.

Battery curves contain only observed samples from a compatible, uniquely
associated episode. Later overlapping or contradictory run windows retire
public sample eligibility while preserving the original observations and
private links. Clock alignment remains unqualified until a real-run comparison.
Lifetime counters remain distinct from the partial retained run inventory.
An observed dock boundary separates later activity into a new episode without
setting an end or completion. Delayed completed records revisit these separate
windows; an old record never triggers a current-map capture.

A run-end map is captured only after its matching record commits. Decoded bytes
stay in a private deduplicated BLOB archive with request/response time, map
index/sequence, generation and before/after observations. The V1 header contains
no run identifier. Every capture remains unverified; failed, late, interrupted
or conflicting windows never establish coverage. Startup-only history does not
receive a retrospectively captured current map.

Archive/projection writes and one admitted state batch share an Outbox
transaction. A refused prior publication blocks admission of another batch,
while new originals and the latest projection can still commit with a durable
publication-needed flag. Storage failure retains one bounded pending batch
with stable observation IDs and stops further capture until recovery. A
committed archive is separate evidence from successful publication.

After a restart, successful status recovery closes prior unavailable intervals
in pages of at most 100, retaining their original versions and first recovery
time. A persisted cursor revisits unresolved episodes from older generations
and dock-bounded windows from the current generation in pages of 25.
An explicit completed record with a compatible end can close an old episode;
overlapping or conflicting evidence can still leave its samples unattached.
Recovery never requests a current map for historical records.

## Private manual backup and recovery

The archive is `<state-root>/modules/roborock.sqlite`. Retention has no automatic
expiry or pruning. Raw readings, record versions, room mappings, battery
observations and decoded maps are personal data under
[ADR 0011](../../docs/decisions/0011-private-personal-data-retention.md).
Keep originals and backups in private owner-controlled Linux storage outside
every Git checkout. Do not attach them to issues, PRs, logs or CI artifacts.

With separately authorized runtime maintenance, stop the sole runtime owner
cleanly before making or restoring a backup. Verify its process has ended and
no writer holds the database. A live copy of the SQLite file alone can omit
committed WAL data. A clean close normally checkpoints the WAL; if sidecars
remain, preserve the complete database/WAL set privately and investigate the
close before proceeding. Keep the original set intact, use copies with mode
`0600` in a `0700` directory, and verify the copied archive's identity, record
inventory and integrity before using it for recovery.

Restore only while the owner remains stopped, with the original archive and
sidecars retained separately for recovery. Never mix sidecars from different
copies or change the archive's robot identity to admit a new target. Restart
through the owning runtime procedure and verify its running identity, health,
retained inventory and new restart gap. This manual procedure grants no
runtime authority and does not qualify an installed storage adapter.

## Field qualification

Object and exact positional V1 layouts derive from the pinned MIT source below.
No timestamp scan, string coercion or magnitude-based unit guess is accepted.
`clean_time`, record `duration` and consumable `_work_time`/`_dirty_time` values
are seconds. Areas are square millimetres; `area` and `cleaned_area` stay
separate. `strainer_work_times`, `cleaning_brush_work_times` and
`dust_collection_work_times` are cycle counts. `extra_time` has no proven unit
and is retained privately as a raw number; its seconds measurement is unknown.

Unfamiliar numeric status, error, start and finish codes retain their numeric
value without an invented label. Dock `dss` bit meanings are source-qualified
only; this guide claims no exact-model wash/dry semantics or default consumable
lifetimes. `avoid_count` is a vendor avoidance count, not a count of distinct
obstacles. Missing, invalid and unqualified fields remain unknown.

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
[Roborock module checks](../../docs/development.md#roborock-module-checks) and
[Roborock transport checks](../../docs/development.md#roborock-transport-checks).
Module checks include the actual-runtime browser journey, recursive browser
boundary fixtures, both SDK transports and a disposable runtime scenario.
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
`{ok: false, error: ErrorBody}`. Missing vendor domain fields remain missing.
The registered module owns normalization. Current maps return private `Buffer` bytes, with no
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
