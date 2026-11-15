# Everything Presence Pro

One fixed runtime module reads one or two explicitly configured stock ESPHome
Native API devices. It publishes `presence-observation/2.0` through SDK sync,
`GET /api/v2/families/presence-observation` and the existing private core history.
These reads require the existing read authentication. It sends no device-setting
or actuation commands. Native connection, subscription, ping and disconnect
traffic can animate vendor status LEDs.

The [stock interface](../../docs/presence-pro-interface.md) defines the limitations
and apartment transform. This source does not establish hardware compatibility
or physical accuracy. Enrollment and the practical trial belong to
[#1842](https://github.com/jimmie-potts/agent-device-hub/issues/1842).

## Private configuration

Add `modules["presence-pro"]` to the normal private runtime configuration. A
section contains `sensors`, one or two distinct entries. The following is a
synthetic single-sensor example; its addresses, keys, room and geometry are
fictional. A second entry uses its own ID, exact endpoint and MAC.

```json
{
  "sensors": [{
    "id": "presence-a", "address": "192.0.2.41", "port": 6053,
    "mac": "020000000041", "roomId": "synthetic-room", "mappingRevision": 1,
    "security": {"mode": "noise", "keySecret": "presence-a-key"},
    "occupancy": {"key": 1}, "held": {"key": 5},
    "zones": [{"id": "zone-one", "roomId": "synthetic-room", "binding": {"key": 6}}],
    "targets": [{"slot": 1, "x": {"key": 2}, "y": {"key": 3}, "active": {"key": 4}}],
    "settings": {
      "detail": {"key": 7}, "angle": {"key": 8}, "upsideDown": {"key": 9},
      "range": {"key": 10}, "exclusions": [{"key": 11}, {"key": 12}]
    },
    "calibration": {
      "revision": 1, "tx": 2, "tz": 3, "yaw": 1.5707963267948966,
      "angle": 0, "upsideDown": false, "rangeCm": 600
    }
  }],
  "secrets": {"presence-a-key": "/private/example/presence-a-key"}
}
```

Use existing room IDs. `mappingRevision` changes when sensor/zone assignments
change. The module owns no room registry and chooses no room from a coordinate.
`zones` may be empty or contain up to four explicitly mapped reports; `targets`
may be empty or contain up to three source slots. `held`, `settings` and
`calibration` are optional. Without interpretable settings, targets have no usable
coordinates; without calibration, apartment positions remain unknown.

Bind the selected Native API **numeric keys**, checking discovered entity types
each connection. API 1.14 can omit `objectId`; an optional exact `objectId` check
is available only when the device advertises it. YAML source IDs and display
names are not numeric keys. Enumerate actual entities with the selected client's
read-only `Connection.deviceInfoService()` and `listEntitiesService()` on the
separately authorized pilot target. Do not guess a key or endpoint. The module
verifies the configured MAC before subscribing and refuses missing, ambiguous or
wrongly typed bindings with `unsupported-capability`.

Binding types are fixed: occupancy, held, zones and Active use `BinarySensor`;
X/Y use `Sensor`; detail uses `Select`; angle and range use `Number`; upside-down
uses `Switch`; both exclusions use `Text`. Detail must report stock
`Above + Targets active`, `Above + Distance and Angle` or
`Above + Speed and Resolution`. Range is the stock **centimeter** setting.
Empty exclusion text means no polygon; otherwise use the stock semicolon-separated
integer millimeter `x:y` vertices (3–20). Invalid or missing settings inhibit the
point. Exclusions are tested in published coordinates, after firmware angle/flip.

`calibration` saves translation and yaw in apartment XZ meters/radians and the
manually checked angle/flip/range settings. The firmware already applies angle
and flip; the module does not apply them twice. A changed setting clears axes;
apartment projection requires the checked settings again. After moving a sensor
or changing relevant geometry/settings, update the transform and its revision
and restart through the normal runtime procedure. Restart starts unknown, then
recomputes from reports for the new connection. No live configuration API is added.

`security.mode` is explicitly `noise` or `plaintext`, matching the selected
device. Noise requires a private 32-byte base64 key file through `keySecret`.
An optional `passwordSecret` references an existing private password file in
either mode. Plaintext is used only when explicitly configured; there is no
fallback from Noise or from a rejected password. Secret files use the runtime's
normal private-file checks. No firmware provisioning or security-setting write
is included. Unreachable or incompatible units remain disconnected/unknown.

The module ships in the configured Mac production profile with device control
explicitly enabled. Its simulation declaration preserves refusal by restricted
browser profiles. `--simulate` uses fictional reports and contacts no device.

## Consumer record

Import browser-safe types and constants from
`@jimmie-potts/presence-pro/contracts`; Node hosts import the package root for
its factory and schema registration. Each configured sensor always has its own
complete current record, including while starting or disconnected.

`occupancy.value` and zone `value` are `occupied`, `vacant` or `unknown`.
`held.value`, Active, raw axes, apartment points, calibration revisions and
receipt times use the profile's `{status:"unknown"}` or
`{status:"known",value:...}`. A point is an **approximate device-reported
position**. Keep `held` visible beside it; an unknown hold flag stays unknown.
Initial subscription state may be firmware-cached. Every `receivedAtMs` means
when this runtime received that scalar, never when the sensor measured it.
X/Y can have different receipts. Envelope publication time is independent.

Unchanged reports remain usable while connected; there is no occupancy TTL.
Inactive, missing, disabled, malformed, nonfinite or masked targets clear their
usable axes. Both axes must be reported again after that reset; `(0,0)` alone
never creates a point. Slot numbers carry no identity or continuity. Keep
disagreeing sensors separate; do not sum overlapping counts or fuse slots.
Disconnected/restarted state is unknown. Old-connection callbacks cannot revive it.

## Ownership, failure and storage

One acquisition owner per sensor uses a fresh client per connection. The module
bounds secret-read/connect/discovery work to five seconds, cancels and disposes
the attempt, then retries on one timer with 1/2/4/8/16/30-second capped backoff.
The library's reconnect is disabled. A failed sensor leaves the other usable.
Heartbeats observe transport health, not physical sample age or sensor accuracy.

Only the SDK owner revision is stored in `presence-pro.sqlite`. Live reports
are never restored. Publications coalesce to one pending current state per
sensor; dropped observations and history gaps are accepted. Core history keeps
normal change rows and SDK duplicate handling. Its existing bookkeeping accepts
the occupancy receipt's numeric leaf; zone/target/held receipt changes can remain
ordinary change rows because current bookkeeping does not admit array positions
or hold members. No raw archive, replay queue or new recovery store is added.

Endpoints, key material, room geometry, occupancy, coordinates and receipt times
stay private. Authenticated existing read-scoped clients can read reports and
history. Diagnostics contain only neutral configured IDs and registry codes;
third-party raw logs, device payloads and secrets are not exported. No trace
context is sent to a device and no model/cloud sharing is added.

The pinned client is `@2colors/esphome-native-api` **1.3.7** (MIT), using Node 24,
`google-protobuf` and `noise-c.wasm`. It selects one encryption transport at
construction, supports existing passwords and returns protobuf scalar defaults.
The earlier `esphome-client` 2.1.0 candidate lacks password support and permits
opportunistic Noise-to-plaintext fallback, so it was not selected.

Two narrow per-instance compatibility fixes in `src/native.ts` rely on this
pinned client's internals: preserve modern switch `missing_state` field 4 before
the older generated switch decoder discards it, and retain teardown error sinks
while the client's bounded five-second request timers/Noise initialization settle.
Recheck these regressions before upgrading the dependency. Network/protocol
failure is `unavailable`, identity/explicit password or local key refusal is `forbidden`, and
missing typed bindings are `unsupported-capability`; none means vacancy.
The client exposes no typed Noise failure code, so unclassified Noise/key errors
remain `unavailable`; they never trigger plaintext fallback.

## Source evidence

After `npm run build`, run `npm run test:presence-pro:built` and the runtime test
`node --test apps/runtime/dist/tests/presence-pro.test.js`, plus the shared checks
in [development](../../docs/development.md#presence-pro-source-checks).
The focused suite runs within the existing runtime CI test aggregation.
Tests use two fake sources and actual loopback Native API plaintext/password and
Noise handshakes, omitted scalar defaults, invalid authentication, slot resets,
calibration, disconnect fencing and late teardown. The disposable runtime test
reads authenticated state/SDK sync/core history. This verifies software behavior;
the physical pilot remains separate.
