# Presence Pro stock-interface pilot

**Proposed definition, revision 2.** The owner's 2026-11-14 scope decision
(America/New_York; research continued on November 15 UTC) selects a small stock
ESPHome pilot: show the latest device-reported occupancy/zones and approximate
anonymous positions. This supersedes revision 1's continuously fresh/atomic-frame
prerequisite. Firmware telemetry is deferred until the pilot demonstrates a need.
This definition implements nothing and authorizes no installation or device contact.

Use one fixed module in the current Mac Mini Linux ARM64 runtime, SDK/profile 2.0,
existing room IDs and authenticated consumers. The module owns acquisition;
core owns room identity/history; the apartment view renders the reports. Follow
[ADR 0016](decisions/0016-brain-and-local-edges.md),
[ADR 0012](decisions/0012-bunny-event-platform.md) and the
[diagnostic contract](observability-contract.md). No Home Assistant deployment,
broker, generic sensor framework, identity inference or device actuation is needed.

## What the stock interface establishes

Research used official Pro **v1.3.0**, commit
`2f106f4ad7790a3e269d63e1d20d8518892f15a1` ([release](https://github.com/EverythingSmartHome/everything-presence-pro/releases/tag/v1.3.0)).
Its LD2450 base matches inspected main `0f892caa35f6ad2dda0d740c73d374bba99bf2eb`.
The build uses ESPHome `latest`; discover the actual units' firmware/core versions.
ESPHome 2026.10.0 links below are protocol references, not an installed-build claim.

| Capability | Primary evidence / documented behavior | Pilot qualification |
| --- | --- | --- |
| Product/occupancy | [Pro overview](https://docs.everythingsmart.io/s/products/doc/everything-presence-pro-nh3fIXmow9) and [Pro base](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/everything-presence-pro-base.yaml): PIR OR static OR tracking, delayed off; default occupancy delay 15 s | Actual firmware, placement, output and exit delay unverified. |
| Zones | [LD2450 base](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml): four polygon zones, exclusion masks, entry/assumed-presence logic | Published [entity docs](https://docs.everythingsmart.io/s/products/doc/home-assistant-entities-Ly0FOHdynj) lag polygon changes; discover actual entities/settings. |
| Coordinates | [Glossary](https://docs.everythingsmart.io/s/products/doc/glossary-of-terms-Ch8dvsNrrp): X negative left/positive right, Y forward, millimeters relative to sensor; firmware angle/flip modifies output | Approximate 2D points only; exact origin, accuracy and floor projection need a manual check. |
| Range/counts | Advertised tracking up to 6 m, static presence up to 25 m; three LD2450 report slots; per-zone counts can overlap | No warranted position error, durable person ID or whole-device people-count entity established. Do not sum counts. |
| Cadence | [Parser gate](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L898): 0.1–0.5 s processing choice, default 0.3 s; target divisor 1/2/3/5/10/20 | Not a guaranteed API update interval; unchanged reports may remain silent. |
| Hold/disabled output | [Assumed hold](https://github.com/EverythingSmartHome/everything-presence-pro/blob/2f106f4ad7790a3e269d63e1d20d8518892f15a1/common/ld2450-base.yaml#L1038) can freeze coordinates/Active/counts; default OFF; detail settings can produce NaN/false | Active is a reported slot flag, not physical identity. Masked targets and held positions need explicit labels. |
| Time/coherence | [Scalar API packets](https://github.com/esphome/esphome/blob/704551a6c93c29a311802f7ee97d67a9e9bce718/esphome/components/api/api.proto#L568) lack sample timestamps/frame IDs; [equal states are suppressed](https://github.com/esphome/esphome/blob/704551a6c93c29a311802f7ee97d67a9e9bce718/esphome/core/entity_base.h#L306); initial subscription returns cached state | Receipt time means last report received, not sample age. Latest X/Y may be from different updates. |
| Transport | [Native API](https://esphome.io/components/api/) / [protocol](https://developers.esphome.io/architecture/api/protocol_details/): TCP/protobuf, normally 6053; configured plaintext/Noise support | No device contacted. Reachability/authentication unknown; connecting can animate firmware LEDs. |

All physical results remain unverified. Examples below are synthetic calculations,
not simulated or measured sensing. No stock atomic snapshot/read endpoint was
found; this is a known limitation, not a prerequisite for the selected pilot.

Connect directly using each selected device's configured authentication; keep
credentials private and never downgrade after a key/authentication failure.
Do not add a Noise-provisioning prerequisite or change firmware/network settings.
The evaluated Node 24 candidate is
[`esphome-client` v2.1.0](https://github.com/hjdhjd/esphome-client/tree/9cd3d024af9ace1876b31e3365a3907208fa58e9).
Pin/test it during implementation. Use one module reconnect owner; disable nested
library reconnect and construction retries, with bounded connect/discovery attempts
and capped backoff (e.g. 5 s attempts, delays up to 30 s). One device's failure
must not stop the other. An incompatible API or missing required entity is a
named unsupported/unavailable result, never an invented endpoint.

Discover typed entity keys each connection and bind them to the configured device.
Pinned YAML IDs include `occupancy`, `dfrobot_presence`, `pir_motion`,
`ld2450_occupancy`, `assumed_present`, `ld2450_zone{1..4}_occupancy`,
`ld2450_target{1..3}_{x,y}` and `ld2450_target{1..3}_active`. These are source IDs,
not guaranteed Native API numeric keys. Read relevant detail, mask, angle/flip,
range and assumed-presence settings; do not guess meaning from display names.

## Small producer/consumer record

Reserve module family `presence-observation/2.0`, publisher
`bunny/modules/presence-pro`, type `org.bunny.presence-observation.updated`, route
`bunny.state.presence-observation.<id>`. This is a prose agreement; schema/runtime
registration belongs to source implementation. Reuse existing SDK envelopes,
revision/sync/deduplication and tagged unknown values rather than defining them again.
One complete current record per sensor is enough:

| Field | Meaning |
| --- | --- |
| `id`, `sensorId`, `revision` | `id = sensorId`, stable configured neutral device identity; ordinary owner revision |
| `roomId`, `mappingRevision` | Existing room ID and selected sensor/zone assignment revision; no second room registry |
| `connection` | `starting`, `connected` or `disconnected`; connection health only |
| `occupancy` | `{value, receivedAtMs}`; value `occupied`, `vacant` or `unknown`, explicitly the device's reported judgment |
| `zones` | Up to four `{id, roomId, value, receivedAtMs}` reports, explicitly mapped to existing rooms |
| `held` | `{value, receivedAtMs}`; reported assumed-presence boolean or tagged unknown |
| `targets` | At most three source slots: `{slot, active, rawMm, apartmentMeters, calibrationRevision}`; no person/track identity |
| Per-slot values | `active: {value, receivedAtMs}`; `rawMm: {x, y, xReceivedAtMs, yReceivedAtMs}`; coordinates tagged unknown or finite numbers; `apartmentMeters` tagged unknown or `{x, z}` |

Payload times are runtime UTC milliseconds or tagged unknown until received.
They are **last report receipt times**, not observation/sample timestamps. Envelope
publication time remains separate. There is no invented source clock, boot/frame
certificate, confidence score or TTL. Repeated unchanged values do not become
unknown merely because time passes: stock suppression can leave a stationary
person silent. A connected device may retain old reports or fail internally;
show that limitation and the last report times rather than calling them fresh.

On startup/disconnect clear the usable projection to unknown. On reconnect clear
partial slot values and accept only values received in that connection. Initial
cached values may populate the **device-reported** projection; receiving them does
not make them newly measured. Ignore callbacks from the previous connection.
SDK duplicates/old revisions do not apply twice; scalar arrival order is only
adapter order, with no claim to detect an older physical measurement. Malformed
input affects its channel, not another sensor. Unknown/missing input never means
vacancy, departure or a successful physical observation.

A point uses latest finite X/Y and Active received in the same connection, with
tracking detail/configuration sufficient to interpret them. Independent timestamps
and mixed updates are allowed: label the result **approximate device-reported
position**. Active false, missing-state, NaN, disabled detail or uninterpretable
mask/configuration means no usable point. Never infer a person from `(0,0)`;
ordinary target loss also clears coordinates to zero: treat that pair as no point.
Clear the usable slot cache on inactive/invalid/disabled reports; reactivation
requires both X/Y again after that reset, avoiding reuse of a previous occupant's
values. Omit known excluded/masked points. Held true labels the point
held; unknown hold state remains explicitly unknown. Even Active true and hold
false do not prove a new measured frame. Slot reuse/crossing/reacquisition carries
no identity continuity. Never fuse two sensors' slots or add overlapping counts.

Keep device reports separate when sensors disagree. A simple room projection may
show occupied if either reports occupied, vacant only if all configured contributors
report vacant, otherwise unknown; show disagreement and disconnected contributors.
This is reported occupancy, not guaranteed coverage. Art can use it as optional
reported eligibility. Couch history can record reported couch-zone intervals;
it cannot call them sitting, identify the owner or bridge disconnect gaps.

Use existing core history on a best-effort basis, including its repeat-span rules.
No feature-specific durable queue, replay/repair or second archive is required.
Downtime and lost observations/history are acceptable for this personal pilot;
report gaps honestly. No backup/rollback ceremony is added. Reuse existing registry
errors (`invalid-message`, `unsupported-capability`, `unavailable`, authentication
refusals and storage errors), SDK diagnostics and trace continuity. A failed read
or save never becomes vacancy/success. Keep payloads/credentials out of diagnostics,
and send no B.U.N.N.Y. trace context to the device. No configuration commands are
part of this acquisition path.

## One saved apartment transform

Use the [prepared apartment](../apps/runtime/APARTMENT.md): meters, +Y up,
footprints in XZ. Save one sensor placement transform and calibration revision
with its room mapping. Normalize published millimeters once, accounting for any
firmware angle/flip already applied: `x = rawX / 1000`, `forward = rawY / 1000`.
For a manually checked planar mounting, apply translation after yaw rotation:

```text
X = tx + cos(yaw) * x + sin(yaw) * forward
Z = tz - sin(yaw) * x + cos(yaw) * forward
```

Positive yaw rotates +X toward −Z, matching apartment preparation. Height is
unknown; a floor marker is presentation, not measured target Y. Tilted/ceiling
mounts need their own manual projection check. Keep the private transform/settings
outside Git. Recheck after sensor movement, coordinate-setting changes or relevant
room geometry changes. An artwork-only/model-content edit does not invalidate
geometry automatically. Use a new calibration revision when the transform changes;
unusable/missing calibration leaves the apartment point unknown.

Synthetic check: `tx = 2`, `tz = 3`, `yaw = π/2`; raw `(1000, 2000)` mm becomes
`(1, 2)` m and apartment `(4, 2)` m. Inverting the transform recovers `(1, 2)`.
Against fictional reference `(3.8, 2.1)`, errors are `+0.20 m` on X,
`−0.10 m` on Z and radial `0.224 m`. This verifies arithmetic, not device accuracy.
A point on a shared room boundary is ambiguous; do not choose a room by array order.

## Short arrival trial and handoff

A separately authorized trial fills exact targets privately: device bindings,
endpoints/credentials, actual firmware/entities/settings, selected rooms/zones,
mount positions and saved transforms. Start with one device, then the second.
Connecting/subscribing may animate its status LEDs; record that expected effect.
No firmware, device-setting or other-device write is included. Stop/disconnect
if the target is wrong, outputs are uninterpretable or unexpected effects occur.

Pick a few tape-marked points (left/right, near/far, one zone boundary), compare
reported X/Z with those positions and adjust/check the transform manually. Try
entry/exit, a minute of stillness, boundary jitter, temporary occlusion, two people,
overlap between devices, disconnect and reconnect. Use a watch and manual notes;
no audio/video capture. Record actual delays including firmware off-delays, rough
position error, held/missing points and whether the view is useful. Choose practical
"good enough" limits before trying it (for example, roughly within 0.5 m at marked
points and sensible zone transitions); if it misses them, document the limitation
and keep room reports useful. No formal percentile/statistical campaign is needed.

Synthetic consumer readback: entry/exit follows explicit reported states; silence
during stillness preserves the last report; boundary jitter is approximate movement,
not proven room transitions; duplicate/reordered SDK records do not duplicate
intervals; disconnect/restart is unknown until this session's reports arrive;
partial X/Y remains approximate; overlap is not two identified people; conflicting
sensors stay visible. These are source-test examples, not physical qualification.

[#1841](https://github.com/jimmie-potts/agent-device-hub/issues/1841) can implement
stock acquisition, this small record, approximate projection and fake consumer
examples now. Actual entity behavior, useful placement, zone coverage and positional
usefulness belong to [#1842](https://github.com/jimmie-potts/agent-device-hub/issues/1842)'s
arrival pilot. Hand its findings to the apartment/art/couch consumers; the
[apartment view](https://github.com/jimmie-potts/agent-device-hub/issues/1837) keeps
anonymous reported points distinct from owner location. Better telemetry is a follow-up only
if this pilot proves inadequate; atomic freshness and owner identity are deferred.
Keep original observations/geometry privately under [ADR 0011](decisions/0011-private-personal-data-retention.md);
only synthetic/sanitized evidence goes to GitHub. Credentials remain excluded.
No new cloud/model sharing, ambient capture, posture inference or navigation is
selected. This definition-only delivery does not install or qualify the pilot.
