# LIFX controller

`@jimmie-potts/lifx-controller` is an in-process TypeScript controller with direct
UDP transport and fake-tested per-bulb queues. The
[local controller host](../../apps/local-controllers/README.md) (#289) owns one
instance, holds a writer lease per bulb address and serves it to the hub: controller
v1 for power and brightness, and this package's `lifx-light` profile for color and
color temperature. Neither is installed yet. Source validation sends no bulb traffic.

## Ownership and configuration

Construct `LifxController` with `controllerId`, `sourceId` and 1–32 `bulbs`.
Each bulb has a neutral `deviceId`, private numeric unicast IPv4 `address`, and
qualified `vendor`, `product`, `firmwareMajor` and `firmwareMinor` evidence.
Addresses and device IDs must be unique within the owner. Construction opens no
socket; no discovery or polling occurs. Addresses ending in `.0` or `.255` are
conservatively rejected without subnet information. Hostnames are not accepted.

Only vendor 1/product 27/firmware 2.90 is currently qualified: LIFX A19, color,
power, brightness and 1500–9000 K. This mapping comes from
[qualification](https://github.com/jimmie-potts/agent-device-hub/issues/17#issuecomment-5801713572)
and the [official product catalog](https://github.com/LIFX/products/blob/8adbe485db11621639f693f3a1510603f029c902/products.json).
Unknown models or firmware remain unsupported; effects are always off.
Do not infer a model from the user's informal bulb name.

The installing host must designate this owner as the only writer for these
bulbs. The package serializes operations within its instance; it does not acquire
a cross-process lease. Its in-process caller is trusted. Any future network
surface must authenticate and authorize before calling it, including replay and
reads. Configuration is an operator boundary, never a caller command argument.
Home Assistant and cloud accounts are not dependencies.

## Commands and reads

`snapshot(deviceId)` returns `{profile, controller, lighting}`. `controller` is a
valid shared v1 snapshot with request ID, configuration revision and generation.
Use those values in `submit(request)`; never invent a new request ID after a lost
response. Common `power.set` and `brightness.set` commands use the unchanged
[controller v1 contract](../../docs/controller-contract.md).

Color and temperature use the same envelope plus
`profile: {profileId: "lifx-light", profileVersion: "1.0.0"}` and one command:

- `{kind: "lifx.color.set", hue: 0..360, saturation: 0..100}`
- `{kind: "lifx.temperature.set", kelvin: 1500..9000}`

All values are integers. The [strict profile schema](schemas/lifx-light-1.0.0.schema.json)
rejects other fields and versions. This is a device profile, not an extension to
common v1 commands. Color/temperature work appears in `lighting.pending`, while
common work appears in `controller.state.pending`. Both share one queue and
request/revision/generation namespace. No scene, effect, media or mode operation
is supported.

Submission returns admission `decision`, `reserved`, and, once admitted, a
`receipt` and `done` promise for the terminal shared v1 receipt. Identical pending
requests join; retained identical requests replay without traffic. Changed bodies
conflict. The last 256 terminal receipts are retained. Retired identities expire.
`submitMany(requests)` accepts up to 32 envelopes and returns a result per bulb;
one bulb's failure does not undo another's success.

`refresh(deviceId)` queues a LightGet and returns `{ok, failure?}`. `snapshot()`
only reads memory. Reported power/brightness and wire-unit HSBK values carry their
monotonic read clock and age. Failures retain the last observation. An ACK changes
transport evidence, not observation time or visible success. `lighting.visible`
and external-control ownership remain unknown.

Brightness/color/temperature perform a serialized LightGet then an absolute,
zero-duration LightSetColor, preserving other observed HSBK fields. Power uses
DeviceSetPower. Neither color nor temperature implicitly turns a bulb on.
The runtime uses configured unicast UDP 56700 and validates response correlation.
The protocol module supports version/firmware reads for future owning code,
but construction does not query identity automatically.

## Bounds and shutdown

`timeoutMs` defaults to 500 (range 10–5000); `retries` defaults to 1 (range 0–3).
Each attempt has its own socket and correlation identity. At most retries + 1
attempts occur per protocol operation; read-modify-write has two operations.
Retries send the same absolute payload and remain inside the queue turn. A write
without acknowledgment is `uncertain` with possible effects. A failed read before
a write reports no write effects. Replaying either result never restarts work.

`maxPending` defaults to 8 (range 1–32), counting active and queued reads/writes
per bulb. `cancel(deviceId)` retires its generation and aborts active transport;
queued old-generation writes and further retries are cancelled. `close()` stops
admission, aborts active transport and settles queued work. A new instance gets
new epochs and no persisted replay/observation state. Snapshot event/stream limits
are v1 envelope bounds only; this package exposes no feed or listener.

## Source checks

Use Node 24, `npm ci`, `npm run build`, `npm run typecheck` and `npm run test:lifx`
from the repository root, plus the shared checks in
[development](../../docs/development.md#lifx-controller-checks).
Tests inject fake transports and sockets; they use synthetic documentation IPs.
Real installation, bulb traffic and visible acceptance need separate authority.
