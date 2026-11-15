# Presence Pro observation definition

**Definition candidate, revision 1 (2026-11-15).** This is the producer/consumer
agreement and bounded experiment brief for [#1840](https://github.com/jimmie-potts/agent-device-hub/issues/1840).
Acceptance settles this definition only. It neither registers a schema nor
implements, enrolls, contacts, configures or qualifies a device. The two shipping
units' firmware, placement and output remain unverified. All examples below are
fictional; no apartment geometry, device address or observed person is published.

The selected shape is one fixed Presence Pro module in the current Mac Mini
Linux ARM64 runtime, using SDK/profile 2.0. Acquisition belongs to that module;
current observations travel through SDK sync/state and core history to existing
authenticated readers. Core lighting composition continues to own room IDs.
The apartment renderer owns presentation, never acquisition or identity.
This follows [ADR 0016](decisions/0016-brain-and-local-edges.md),
[ADR 0012](decisions/0012-bunny-event-platform.md) and the
[diagnostic contract](observability-contract.md).

## Evidence and selected route

Research on 2026-11-15 used official Pro **v1.3.0**, commit
`2f106f4ad7790a3e269d63e1d20d8518892f15a1` ([release](https://github.com/EverythingSmartHome/everything-presence-pro/releases/tag/v1.3.0)).
Its LD2450 base matches official main `0f892caa35f6ad2dda0d740c73d374bba99bf2eb`.
The official build uses ESPHome `latest`; the release label does not identify
the core in a received binary. ESPHome 2026.10.0 source below is a pinned protocol
reference, **not** a claim about the units' installed core.

| Capability | Primary evidence / documented result | Synthetic / physical / unresolved |
| --- | --- | --- |
| Exact product | [Official Pro overview](https://docs.everythingsmart.io/s/products/doc/everything-presence-pro-nh3fIXmow9): PIR, SEN0609 static radar and LD2450 tracking; eight WiFi/Ethernet/BLE/CO2 firmware variants in [release source](https://github.com/EverythingSmartHome/everything-presence-pro/tree/2f106f4ad7790a3e269d63e1d20d8518892f15a1) | Synthetic contract examples only; actual variant/build unknown; Lite/One/Grid behavior is not substituted. |
| Occupancy | [Pro base](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/everything-presence-pro-base.yaml): PIR OR static OR tracking, delayed off; default 15 s, configurable 1–600 s | Coverage and real exit latency unverified; intentional firmware hold is separate from acquisition latency. |
| Zones | [LD2450 base](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml): four polygon zones, two exclusion masks; v1.3 adds entry/assumed-presence behavior | Synthetic polygon only; real zones/settings unknown. [Entity docs](https://docs.everythingsmart.io/s/products/doc/home-assistant-entities-Ly0FOHdynj) still list rectangles: pinned source takes precedence. |
| Coordinates / units | [Official glossary](https://docs.everythingsmart.io/s/products/doc/glossary-of-terms-Ch8dvsNrrp): X negative left/positive right, Y forward, millimeters, sensor-relative; firmware mounting angle/flip modifies published coordinates | Numeric transform below only; exact case origin, floor projection and precision unknown. Internal compensation must not be applied twice. |
| Range / precision | Advertised tracking up to 6 m, static presence up to 25 m; no warranted X/Y error bound or confidence value found | No physical range/precision qualification; millimeter encoding and raw `resolution` are not accuracy. |
| Counts / tracks | Three LD2450 report slots; [raw validity](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L1029) uses nonzero resolution; zone counts may overlap | Three slots are not durable people IDs; lifetime/crossing association unqualified, cross-device association unsupported. |
| Cadence | [Processing gate](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L898): selected 0.1–0.5 s, default 0.3 s, conditional on arriving frames; target divisor 1/2/3/5/10/20 | Not an API callback guarantee; worst-case latency/gaps unknown. |
| Held / disabled data | [Hold](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L1038) can freeze X/Y/Active and [counts](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L1478); assumed presence defaults OFF; detail settings can emit NaN/false; ordinary loss clears coordinates to zero | Active true is insufficient, including masked targets; false can mean detail disabled; `(0,0)` alone is not a target. Actual settings unknown. |
| Scalar coherence | [Coordinate publication](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L1122) publishes both X/Y when either changes; [API numeric/binary packets](https://github.com/esphome/esphome/blob/704551a6c93c29a311802f7ee97d67a9e9bce718/esphome/components/api/api.proto#L568) lack measurement time/frame/boot/sequence | No stock atomic frame established; synthetic coherent frames are an explicit future capability, not stock output. |
| Unchanged freshness | [ESPHome equal-state suppression](https://github.com/esphome/esphome/blob/704551a6c93c29a311802f7ee97d67a9e9bce718/esphome/core/entity_base.h#L306), change-guarded numbers and cached initial subscription | **Named blocker `stock-observation-freshness-and-coherence`**: no fresh sensing heartbeat/read endpoint found; continuously fresh stationary/vacant evidence cannot be certified. |
| Direct transport / security | [Native API](https://esphome.io/components/api/) and [protocol](https://developers.esphome.io/architecture/api/protocol_details/): protobuf TCP, normally 6053, optional Noise PSK. Pro source has bare `api`, no guaranteed encryption stanza | No connection made. Actual enrollment/security/ARM64 reachability unknown. API connect may animate firmware LEDs. |

No physical result is verified in this table. The official source review found
no configured stock MQTT, web snapshot, serial proxy or atomic observation
endpoint. `get_build_flags` is metadata; `set_update_manifest` triggers updating,
not observation. Source absence does not prove every factory binary identical.

The pinned profile's source IDs are `occupancy` (combined binary),
`dfrobot_presence` (static binary), `pir_motion` (PIR binary),
`ld2450_occupancy` (tracking binary), `ld2450_zone{1..4}_occupancy`,
`ld2450_zone{1..4}_target_count`, `ld2450_target{1..3}_{x,y}` (numeric mm),
`ld2450_target{1..3}_active` (binary), and `assumed_present` (binary hold).
These YAML IDs are not promised API keys or Home Assistant entity IDs. Discover
typed native numeric keys each session, validate units and metadata, and privately
bind them to enrolled hardware/project/build. Read tracking-detail, target-rate,
update-speed, range, angle/flip, mask/polygon and assumed-presence configuration;
refuse unqualified interpretations instead of guessing keys from display names.
Zones 2–4 being disabled-by-default metadata does not disable their computation
or require Home Assistant. No explicit whole-device people-count entity was found;
do not sum overlapping zone counts.

Select a direct, authenticated ESPHome Native API connection to each configured
device, using its exact discovered entity keys and pinned firmware profile.
No Home Assistant deployment, MQTT broker or generic sensor abstraction is
needed. Home Assistant discovery names are explanatory, never stable identity.
Select encrypted enrollment with a unique private PSK; the stock YAML does not
establish that encryption is already configured. Never fall back to plaintext
after a key failure. Missing encryption is a selected enrollment blocker;
provisioning changes require separate scope. The evaluated Node 24 client candidate
is [`esphome-client` v2.1.0](https://github.com/hjdhjd/esphome-client/tree/9cd3d024af9ace1876b31e3365a3907208fa58e9),
ESM/ISC, Node >=22.20; pin and test it in source work, including ARM64,
missing-state/NaN decoding, discovery and API compatibility. Construct
`new EspHomeClient({reconnect: false, …})` and explicitly connect under the module's
deadline/AbortSignal. Do not retain `openEspHomeClient`'s default construction
retries or a nested reconnect loop. It is not installed here.
If the actual firmware lacks that interface or the container cannot reach the
configured endpoint, report `unavailable` and the specific enrollment blocker.
Do not silently choose another transport, flash firmware or enable MQTT.

The Native API delivers entity state, not a timestamped atomic radar frame.
Its initial snapshot can be cached. A keepalive proves connection health only.
An unchanged scalar may be suppressed, and separately delivered X/Y/count values
do not acquire a common measurement time because they arrive close together.
The source profile must distinguish measured radar, PIR and fused/assumed
presence. A firmware-held target or occupied state cannot certify a new radar
measurement. Until a field's freshness is established, expose its latest raw
reported value with unknown freshness and keep usable occupancy/location unknown.

The source implementation can proceed with transport, entity discovery, explicit
unknowns, expiry, independent health, synthetic qualified samples and consumers.
Before enabling **fresh occupied or vacant** output, prove the chosen occupancy
channel's fresh-report mechanism against the pinned firmware and synthetic Native
API server, then confirm its timing on arrival. A qualified periodic report must
be caused by fresh sensing/evaluation, including unchanged occupied and vacant
values; re-sending an old cache on a timer does not qualify. If the stock firmware
cannot provide this evidence, name **occupancy freshness gap** and keep that
channel unknown. Any firmware adaptation needs separate scope and review.
Coordinate/count qualification has its own independent gates below. This definition
does **not** establish all prerequisites for the full fresh-observation source
story. Stock change reports are useful reported transitions; their receipt does
not establish a continuously observed interval.

### Proposed telemetry option; selection pending

A small additive firmware snapshot could close the named gap, but is **planning
only and not yet selected or implemented**. Emit it from each selected successful
LD2450 parser frame, including unchanged measurements: version/build/configuration
identity, boot token, frame sequence, monotonic acquisition time, current sampled
PIR/static GPIO levels and fused occupancy provenance, raw-detected versus
held/masked/disabled flags, all three slots' coherent X/Y, and per-frame zone counts.
A sequence advances only on actual parser processing, never on a connection timer.
Sampling a static GPIO proves that level was read, not SEN0609 internal health.

Reserve internal option name `presence-pro-frame/1.0`, carried by one native
text-sensor/custom message, with at most 8 KiB UTF-8. Before adoption, define its
closed codec and exact bounds, validate frame validity/boot/sequence and buffering
under a synthetic server, and prove API duplicate suppression cannot hide its
advancing sequence. It is not a B.U.N.N.Y. SDK envelope. The normalized contract
below remains the consumer seam. New firmware-source scope and separate
installation authority are necessary; existing no-firmware boundaries stand.

## Reserved producer/consumer contract

These names and fields are reserved prose for implementation, **not a released
schema or endpoint**. Implement the closed schema, validators and focused consumer
fixtures in the source story. Use the shared identifiers, instants, revisions,
tagged unknowns and error body rather than another envelope.

| Profile member | Definition |
| --- | --- |
| SDK owner/source | `bunny/modules/presence-pro` |
| Family/schema | `presence-observation/2.0`; envelope `dataschema` is `https://bunny.invalid/events/presence-observation/2.0` |
| State type/route | `org.bunny.presence-observation.updated`; `bunny.state.presence-observation.<id>` |
| Envelope | Profile 2.0 complete `kind: state` record; `subject = data.id`; fresh message ID for each publication; UTC `time` is publication time; SDK `traceparent`; no state `expiresat` |
| `id`, `revision` | Neutral stable configured sensor ID; persisted monotonically increasing owner revision, also across owner restarts; neither an IP nor a display name |
| `configurationRevision` | Immutable selected firmware/entity/placement/settings revision; changes whenever interpretation changes; no secret content |
| `source` | `{deviceId, firmwareProfile, acquisitionEpoch, sequence}`; stable enrolled hardware binding, exact pinned profile, new neutral epoch per connection, increasing accepted-input sequence within that epoch |
| `mapping` | `{roomId, zoneIds, mappingRevision, calibrationRevision, apartmentDigest}`; existing room IDs, sensor-local zone IDs, immutable selected configuration revisions and exact apartment content digest; no private file path |
| `health` | `{availability, connected, lastReceivedAtMs, code}`; availability `unknown`, `available`, `degraded` or `unavailable`; nullable last receipt; nullable registry code |
| `reported` | At most 64 independently received native channels, each `{channel, value, receivedAtMs, acquisitionEpoch, sequence}`; value tagged unknown or known boolean/finite number; explicitly unqualified reports, never usable occupancy/frame assertions |
| `occupancy` | `{value, reason, evidence}`; value `occupied`, `vacant` or `unknown`; reason from the finite vocabulary below; evidence tagged unknown or one qualified channel sample |
| `zones` | At most four configured zones, each `{id, roomId, mappingRevision, value, reason, evidence}` with the same rules; existing room ID per zone; zone IDs are unique within this sensor |
| `count` | Tagged unknown with reason, or `{status: known, value, evidence}`; integer 0–3 **per sensor**, derived only from coherent measured slots under the selected mask/range policy, never summed zones or an apartment-wide people total |
| `positions` | Tagged unknown with reason, or `{status: known, frameId, evidence, tracks}`; at most three coherent measured targets; `frameId: {bootId, sequence}` from a qualified source, never a callback counter |
| Each track | `{id, sensorMeters: {x, forward}, apartmentMeters: {x, z}, calibrationRevision, precisionMeters}`; `precisionMeters` tagged unknown until measured qualification; anonymous sensor-local association only |

Closed bounds: routing/entity IDs use shared lowercase-kebab `routingId` (1–128 chars),
neutral epoch/boot/message tokens use the shared identifier block, revisions and
sequences are nonnegative safe integers, digests are 64 lowercase hex characters.
At most two sensors, four zones and three tracks per sensor. Track `id` is a new
neutral owner token for each detected continuity interval, never the raw slot
alone. Known numbers must be finite: normalized sensor coordinates ±25 m,
apartment coordinates/translation ±100 m, yaw `[-π, π]`. These engineering bounds
are not supported range. Zero, NaN or absent fields never stand for unknown.
Only health's explicitly nullable metadata uses null; unknown domain values use
tagged branches. The source story implements closed codecs, not arbitrary objects.

For a known channel sample, `evidence` contains `channel`, `provenance`,
`sourceAtMs`, `observedAtMs`, `receivedAtMs`, `validUntilMs` and
`freshnessBasis`. `channel` is the selected entity or qualified frame identity;
`provenance` is `radar`, `pir`, `fused` or `assumed-presence`.
`sourceAtMs` is `{status: unknown}` unless a qualified timestamp is actually
supplied; otherwise `{status: known, value}` in Unix UTC milliseconds with its
clock uncertainty recorded in the pinned source profile. `receivedAtMs` is the
runtime's UTC receipt time. `observedAtMs` is when the module observed the source
report, **not** a fabricated physical measurement time; on direct callbacks it
equals receipt time. All known instants are safe nonnegative integers, no later
than the publication time except `validUntilMs` and a qualified source time within
the explicit clock-error allowance. A sample's receipt must precede
its expiry. Fields sampled independently carry separate evidence and expiry.

`freshnessBasis` names a revisioned source-profile proof: a source timestamp with
bounded clock error, or a fresh live report with a qualified maximum end-to-end
sample age. It is never `connected` or `keepalive`. Raw unqualified values remain
private acquisition evidence and may be retained as explicitly unqualified
reported values; they cannot occupy the known usable branches above. There is
no confidence percentage invented from binary state.

Use the finite reason vocabulary `starting`, `fresh`, `expired`, `disconnected`,
`freshness-unqualified`, `channel-unavailable`, `conflicting`,
`calibration-invalid`, `frame-incoherent` and `unsupported`.
`fresh` accompanies a qualified known value only. A healthy link and unknown
occupancy are valid together; a fresh PIR report cannot renew a radar location.
`assumed-presence` explicitly says that the firmware holds an occupancy hypothesis;
it cannot enter measured coordinate/count branches. A fused occupancy report can
be usable only as the qualified firmware's occupancy judgment with that provenance,
never proof of identity, stationary radar detection or posture.

### Freshness, ordering and recovery

The following numbers are **selected synthetic defaults**, not hardware claims.
They must be either confirmed or revised before a live qualification is accepted.
Use a 5,000 ms occupancy/zone lifetime, 1,000 ms measured-position/count lifetime,
and reject qualified source timestamps more than 250 ms in the future. A live
report basis requires a separately established maximum pipeline age `D`;
`validUntilMs = receivedAtMs + lifetime - D`, refusing a known sample if `D`
is unknown or is at least its lifetime. With a qualified source UTC time,
`validUntilMs = sourceAtMs + lifetime - clockErrorMs`, also bounded by
`receivedAtMs + lifetime` (or the shorter receipt-based maximum when `D` is known).
Expired on arrival is unknown. Source-time qualification
requires a clock mapping; ESP device uptime is not UTC.

Schedule expiry and attempt deadlines with the runtime's monotonic clock.
Never extend evidence when wall time moves backward; a detected wall-clock
discontinuity invalidates current evidence until a new qualified sample. Readers
expire their copies at the deadline even if they miss a state transition.
Sync supplies the current owner's complete records; it never resets their times.

1. Native entity key plus enrolled sensor binding identifies input. Entity names,
   discovery order and IP changes cannot rebind it. Unknown/replaced hardware or
   an incompatible firmware profile refuses enrollment until explicitly selected.
2. Deduplicate SDK delivery by `(source, id)` and state `revision`. For source
   frames with a qualified sequence, reject duplicate/older frame numbers within
   their source epoch. Different content under the same identity is
   `duplicate-conflict`; make that channel unknown immediately, retaining the
   previous dated sample privately as last-known only. A known older source
   timestamp cannot overwrite newer channel evidence.
3. Native API without device sequence/time supplies **adapter receipt order only**.
   TCP order and a local counter do not detect measurement reordering, stale device
   caches or source duplicates. Never assert they do. A coherent source-frame or
   bounded live-report proof is an additional prerequisite for its known branch.
4. On disconnect invalidate current usable evidence immediately and publish unknown;
   keep last-known evidence privately with original times. On reconnect increment
   acquisition epoch, clear partial frames and pending debounce, rediscover and
   verify the same binding/profile. Ignore late callbacks from the previous epoch.
   Initial cached state remains unqualified until fresh evidence arrives.
5. On owner restart publish unknown at a new persisted revision before acquisition.
   Persisted observations are last-known, never current. A sensor reboot/unknown
   boot identity also breaks track continuity. An expired, failed, malformed or
   refused observation never becomes vacancy, departure or successful sensing.

The module keeps each sensor independent. A malformed update for sensor A does not
stop sensor B. Invalid data for a channel makes that channel unknown; connection
health cannot override it. Within one current channel, conflicting equally ordered
evidence makes the channel unknown until a later unambiguous fresh sample. Neither
arrival order nor optimistic fusion resolves an undetectable source conflict.

### Room/zone consumers and history

Map sensors and zones explicitly to existing room IDs. Zone geometry and sensor
configuration remain local inputs, while apartment room identity remains core-owned.
Each aggregate declares its expected contributing sensors and qualified coverage.
Any fresh occupied contribution establishes **anonymous detected occupancy** with
its provenance. Fresh occupied plus fresh vacant reports requires the consumer's
aggregate `{value: occupied, disagreement: true, contributors}`; contributors carry
sensor IDs and source revisions. This consumer projection adds no state owner and
does not cancel a detection. Vacancy requires all selected contributors fresh
and vacant and coverage qualified for that room/zone. Otherwise output unknown.
No detection outside qualified coverage is a claim about the whole room.

Never add counts across sensors or join their tracks from proximity, simultaneous
motion or equal slot numbers. Two overlapping devices can see one person twice;
two close people can appear as one. Keep per-sensor counts and tracks separate.
Track keys are scoped to sensor, acquisition/source epoch and track lifetime.
Slot reuse after loss is a new anonymous track even if its coordinates match.

Art occupancy eligibility receives fresh anonymous occupied/vacant/unknown plus
mapping and evidence deadline; unknown does not assert absence. Couch-history
receives qualified couch-zone occupancy intervals only. It cannot call the person
the owner, call occupation sitting, or bridge unknown gaps. Interval derivation
belongs to its existing consumer, not this module. Past history is input to a
new decision, never a command trigger by itself.

Reuse core history; add no raw archive or persistence owner. Implemented schemas
must declare bookkeeping alongside their module registration. Only numeric
receipt/observation confirmation members may be candidates; expiry deadlines, availability,
occupancy, provenance, epoch, mapping/calibration, tracks, source revision and
ordering evidence remain meaningful state. Review whether the native input is
event-driven before declaring polling: a keepalive is not a poll confirmation.
Apply the installed core span/gap contract rather than claiming every repeated
sample time is archived. Preserve selected unqualified reports within the agreed
observation contract if needed for diagnosis, and document loss from suppressed
unchanged values, missing frames, acquisition failure and publication/storage failure.
Do not promise raw radar packets or data the API never delivered.

### Errors, retries and diagnostics

Use `errorBody`/`SdkError` and the existing registry's fixed `retryable` flags.
These mappings require no new codes:

| Condition | Registry code; retryable |
| --- | --- |
| Invalid mapping, bounds or request | `invalid-request`; false |
| Bad entity payload or nonfinite coordinate | `invalid-message`; false |
| Wrong pinned protocol/schema | `unsupported-version` / `unknown-schema`; false |
| No coherent frame/freshness capability | `unsupported-capability`; false |
| Bad credential / disallowed enrollment | `unauthenticated` / `forbidden`; false |
| Stale calibration or conflicting guarded edit | `invalid-state` / `revision-conflict`; false |
| Reused identity with different input | `duplicate-conflict`; false |
| Network timeout, disconnect or unavailable publisher | `unavailable`; true |
| Storage exhausted / unexpected local failure | `capacity`; true / `internal`; false |

One acquisition owner per sensor controls connect/discovery/subscription and
reconnect. Disable nested library retry loops. Selected defaults: 5 s connect,
5 s discovery/subscription and 2 s observation/sync attempt deadlines; exponential
reconnect delays of 1, 2, 4, 8, 16, then at most 30 s, with bounded jitter never
exceeding 30 s. Only one attempt may run per sensor; cancel it on stop or epoch
change. Nonretryable authentication/profile/configuration failures remain refused
until configuration changes; no hot loop. There is no device write or actuation
queue, automatic reconfiguration or command success outcome for an observation.

Use SDK `recordLog`/`levelOf`, registered operation/feed/message events, static
bodies, neutral IDs and registry codes. Start a local trace for unsolicited source
input; correlate its validation, publication and diagnostics. Preserve SDK trace
continuity, including any stored publication. Never send trace context to the
device/vendor; never log credentials, device payloads, addresses or real geometry.
Summarize repeated failures and record recovery once. Private selected observations
belong in observation/history storage; the closed diagnostic schema is not a
place for arbitrary location payloads. A failed commit does not produce a new
current state; expiry still makes the consumer unknown. A commit followed by
publication failure remains committed/awaiting publication, with original identity
and times on retry; it is never a rollback or fresh measurement. Source work must
test this boundary and record any unrecoverable gap without another archive.

## Apartment calibration and coordinate gate

The [prepared apartment](../apps/runtime/APARTMENT.md) is `apartment-model/1.0`,
meters, +Y up, with footprints in XZ. Match the exact active content digest and
existing room IDs. Radar X/Y names are source-local axes, not apartment X/Y.
Normalize documented millimeters once: `x = rawX / 1000`,
`forward = rawY / 1000`. Verify handedness, forward direction and any firmware
mirroring/offset against manual positions before applying this candidate transform:

```text
X = tx + cos(yaw) * x + sin(yaw) * forward
Z = tz - sin(yaw) * x + cos(yaw) * forward
```

Positive yaw rotates +X toward −Z, matching the apartment helper. Translation
is in apartment meters and is applied after rotation. Sensor measurements supply
no measured height; do not invent a person Y coordinate. Sensor mounting height
and a renderer's floor marker are separate metadata/presentation.

A private immutable calibration record binds neutral device ID, exact firmware
profile and relevant coordinate settings, apartment digest, room/zone mapping
revision, translation/yaw, axis normalization, mount reference, evidence and
qualified coverage/precision. Use a new calibration revision for any change.
Sensor movement, remounting, mirroring, offset/rotation setting change, unknown
configuration, incompatible firmware or mismatched model digest invalidates
location/zone claims immediately. Revalidate or explicitly migrate calibration
against the new model; stable room ID alone does not preserve geometry.
An independently qualified whole-device occupancy channel may remain usable.

The stock scalar route does not yet satisfy the coherent-frame gate. At most,
retain its explicitly unqualified coordinates for the bounded private experiment;
`positions`/`count` stay unavailable unless their own source evidence qualifies.
A source frame must tie active flags, finite coordinate pairs and count to one
actual measurement and distinguish fresh measurements from frozen assumed targets.
Do not synthesize `frameId` from the three entity callbacks or combine last-known
values. No cross-sensor association is qualified by this definition.

## Synthetic calibration and behavior examples

These numbers check the definition, not hardware performance. A fictional sensor
has `tx = 2`, `tz = 3`, `yaw = π/2`. A measured source point `(rawX, rawY) =
(1000, 2000)` mm normalizes to `(1, 2)` m and transforms to apartment
`(X, Z) = (4, 2)` m. An inverse check recovers `(1, 2)`.
For a known apartment point `(3.8, 2.1)`, errors are `eX = +0.20 m`,
`eZ = −0.10 m`, radial error `sqrt(0.20² + 0.10²) = 0.224 m`.
These are synthetic residuals, not precision metadata.

The fictional couch polygon has X in `[3, 5]` and Z in `[1, 2]`.
A selected 0.15 m interior margin means `(4, 1.9)` is boundary-uncertain,
while `(4, 1.8)` is interior. The tolerance is a consumer experiment policy,
not a claim about the sensor. For coordinate-derived zones, require interior
points for 1 s before entering, and exterior points beyond the same margin for
2 s before exiting. In the margin publish unknown; reset dwell on stale or
incoherent input. Do not apply this fictional geometry to firmware zones.

For freshness examples below the synthetic profile proves a fresh report's
maximum pipeline age `D = 200 ms`. Receipt at `t = 10,000 ms` gives occupancy
expiry at `14,800 ms` and coherent-point expiry at `10,800 ms`. At expiry the
channel is unknown, without waiting for another packet. Example times are
relative to a fictional UTC epoch; actual payload instants use Unix time.

| Case | Input and expected usable result |
| --- | --- |
| Entry/exit | Fresh vacant at 0; fresh occupied at 1,000; fresh vacant at 4,000: transitions follow those qualified channels, with independent expiry. Exit requires explicit fresh vacancy, not silence. |
| Stationary person | Qualified fresh occupied reports at 1,000 and 4,000 renew occupancy. A keepalive at 7,000 does not; without another qualified report it becomes unknown at 8,800. Frozen assumed coordinates remain unavailable throughout. |
| Boundary jitter | Points `(4, 1.90)`, `(4, 2.05)`, `(4, 1.95)` at 0/400/800 ms remain unknown for couch assignment. Interior `(4, 1.80)` reports from 1,000 through 2,000 ms establish entry only at 2,000; stale input resets that dwell. |
| Two devices | A loses connection at 2,000 and becomes unknown immediately; B's fresh observations remain usable on their own deadlines. A's reconnect does not reset B. |
| Overlap | A and B each report one anonymous target in overlapping coverage. Room occupancy may be occupied; total count is unknown, never two. Same sensor slot numbers do not establish the same person. |
| Duplicate/order | Qualified epoch E frames 11, duplicate 11, then 10 produce one accepted frame; same 11 with different content is conflict. Native callbacks without frame IDs cannot claim this source-level guarantee. |
| Dropout | Occupied received at 10,000 expires at 14,800 even with a live socket. A gap is unknown, never vacant or a couch interval extension. |
| Restart/reconnect | Owner restart at 12,000 publishes unknown at the next persisted revision. A cached occupied initial state does not reopen the interval. A fresh qualified report at 13,000 can. |
| Conflicting evidence | A fresh occupied and B fresh vacant yield occupied plus explicit disagreement. Both vacant with one expired yield unknown. Equally ordered incompatible samples for one channel yield unknown. |
| Partial coordinates | New X arrives at 10,000, old Y remains from 9,000, count arrives at 10,020: no coherent point or count is invented. Fresh occupancy remains independent. |
| Movement/model edit | New mount or apartment digest invalidates the transform, even if coordinates still look plausible; positions and coordinate-derived zones are unknown until requalified. |

## Bounded arrival commissioning and experiment

This brief is preparation only. Its execution requires the separate installation
and actual-device task and selected owner-authorized targets. Fill the private
record with each exact neutral device binding, endpoint/port, credential reference,
firmware/image digest, ESPHome/API versions, entity discovery, coordinate settings,
room/zone IDs, mount pose, apartment digest and calibration revision. Retain the
actual originals outside checkouts/GitHub, following the apartment preparation
guide's private-file rules. Never publish real addresses, floor plans or traces.

Before starting, write down the selected test start/stop times, manual reference
points, all tolerances, expected contributors/coverage and a restoration plan.
Initial trial defaults to settle: acquisition latency at most 2 s after the
firmware's indicator transition; physical exit latency is measured separately
against selected PIR/tracking/occupancy off-delays (stock delays can compound,
so 2 s is not a stock physical-exit promise). Require stationary
occupation maintained for 120 s with no false vacancy; 10 entry/exit cycles in
each qualified zone; no false vacancy on intentional loss. For coordinates choose
axis bias at most 0.20 m, radial p95 error at most 0.50 m, and maximum error at
most 1.00 m **before collecting**. These are proposed acceptance thresholds for a
small indoor trial, not the device's claimed specification. Refine them against
consumer need before the run, never after inspecting results to obtain a pass.

Use tape-measured marked floor reference positions in the prepared apartment
frame. Record uncertainty of the marks and whether the radar reflection point can
be compared with a floor position; a person's body is not an exact survey target.
A manual observer records enter/exit/movement and hold times with the same runtime
UTC clock or an explicitly measured offset/uncertainty. Keep monotonic elapsed
times for latency. No camera, microphone or ambient recording is selected.

Bound the first session to 45 minutes: device/entity inspection, one sensor at a
time, then overlap. At each of at least five noncollinear known positions, spanning
left/right, near/far and zone boundaries, hold 20 s and repeat three times.
Record paired axis residuals and radial errors; report bias, median, p95, maximum,
missingness, update interval/maximum gap and reference uncertainty. Compare exact
firmware outputs with measured results, including whether repeated coordinates
are new measurements or held values. Include behind-furniture/occluded cases,
near/far range edge and an out-of-range position, stationary presence, two and
three simultaneous targets, an attempted fourth, crossing paths, target loss and
reacquisition, and two-sensor overlapping views. If time expires, mark remaining
cases inconclusive and schedule separately; do not rush or invent coverage.

Read-only enrollment, subscribe/unsubscribe and local recording of the selected
observations are the intended effects. Firmware may animate its RGB status LEDs
on client connection/subscription; include that exact-target visible effect in
the selected trial authority and record it. No explicit LED command is needed.
Configuration writes are excluded from
this brief's default run. If a separately authorized trial selects a device
setting change, enumerate its exact setting, old/new value, expiry and expected
effect first; snapshot it privately, use the designated writer and read it back.
An uncertain save requires readback before another explicit attempt, never an
automatic command retry. Firmware flashing, factory reset, network changes,
device movement outside the selected pose and other-device actuation are excluded.

Stop on identity mismatch, unexpected write/reboot, missing encrypted access,
unknown firmware behavior, invalid manual reference, sensor movement, false
vacancy during intentional dropout, secret exposure, sustained acquisition loss
or the session deadline. Disconnect this collector; retain private evidence and
record the gap. Restore any separately authorized settings from their private
snapshot and verify them; an uncertain restoration remains an explicit unresolved
condition. Do not roll back other owners' work or discard originals.

For each capability record **supported**, **refuted** or **inconclusive**, the
exact tested firmware/settings, measurement uncertainty, counts of successful/
failed/missing cases and qualified coverage. A refuted/inconclusive coordinate
result leaves occupancy independently eligible if its tests pass. Hand the private
calibration and sanitized conclusions to the apartment consumer; do not close its
location/identity obligations with room occupancy alone.

## Delivery and privacy handoffs

The source story can implement the reserved contract and fake transport, direct
Native API acquisition, current state/health, history integration, explicit
unsupported branches and all synthetic cases. It must resolve the pinned-profile
freshness proof before claiming useful fresh occupancy. Exact enrollment, actual
unchanged-report cadence, loss behavior, zone coverage, coordinates/count coherence,
track lifetime and physical accuracy require device evidence. The apartment view
can consume qualified rooms independently; point markers require coherent measured
coordinates and valid calibration. Owner labels require separately justified
household association; this definition supplies none.

Retain selected observations, private calibration, room bindings and experiment
originals privately under [ADR 0011](decisions/0011-private-personal-data-retention.md),
using core history and its selected repeat-span loss. Credentials remain excluded
from observations and diagnostics. Existing authenticated runtime readers retain
their existing access boundary; no new export, cloud destination or model call is
implemented here. ADR 0011 permits room-level presence as input to a Decisions
decision within its selected policy, but that does not select collection or
authorize exact coordinates, anonymous tracks or identity under that allowance.
Real geometry/location never goes to GitHub, including private issue/PR text,
Actions logs or artifacts. Publish only synthetic fixtures or independently
sanitized summaries while retaining the private originals. Identity, posture,
cooking, Yoshi recognition and navigation remain unqualified; the ambient-capture
hold remains in force.
