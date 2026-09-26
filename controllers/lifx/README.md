# LIFX controller

`@jimmie-potts/lifx-controller` is an in-process TypeScript controller with direct
UDP transport and fake-tested per-bulb queues. The
[local controller host](../../apps/local-controllers/README.md) (#289) owns one
instance, holds a writer lease per bulb address and serves it to the hub: controller
v1 for power, brightness and mode, and this package's `lifx-light` profile for color
and color temperature. Since #20, a qualified bulb in Work or Quiet also shows
automatic agent status, painted internally through the same controller (see
[Automatic agent status](#automatic-agent-status)). Neither is installed yet.
Source validation sends no bulb traffic.

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
request/revision/generation namespace. No scene, effect or media operation is
supported. A qualified bulb supports `mode.set` (Work/Quiet/Free); see
[Automatic agent status](#automatic-agent-status) below. An unqualified bulb
advertises no modes at all.

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

`closeGracefully()` (since #20) is the alternative for an orderly shutdown: it
stops admission and retires every job still queued (each becomes `cancelled`
with no traffic the instant it would start) without aborting a job already in
flight. The in-flight job settles on its own — already bounded by
`timeoutMs * (retries + 1)` — and only once every job has settled does it
close the transport. The owning host uses it, after stopping its status
publisher, so a paint already reaching the bulb completes honestly instead of
being cut off mid-write.

## Automatic agent status

The user settled these on 2026-09-25 for #20. Modes exist only when the owner
configures `modeStateRoot` in `Options`: the package has no default of its
own, so a qualified bulb constructed without one still advertises
`modes: {supported: false}` and `mode.set` is `unsupported-capability`. The
owning host supplies this path from its own configuration (see the
[local controller host guide](../../apps/local-controllers/README.md#configuration));
source tests always pass a temporary directory, never a real home directory.

With a configured root, a qualified bulb's mode is Work, Quiet or Free,
persisted atomically under it, one file per bulb keyed by its `deviceId`
hash. The controller reads the persisted mode once at construction; a
missing or invalid file defaults to Free. Both the read and the write treat
an unsafe directory or file the same way an unsafe private configuration file
does elsewhere in this codebase: the directory is created at `0700` if
missing, then required to be a real directory owned by the current user with
no group/world permission bits, or the read defaults to Free and the write
fails closed. The file itself is opened `O_NOFOLLOW` (so a symlinked path is
never followed) and, on read, must be a small regular file owned by the
current user with no group/world permission bits; anything else, including a
missing file, counts as Free. A write uses an exclusive (`O_CREAT|O_EXCL`),
non-following temporary file at `0600` in the same directory, then an atomic
rename.

`mode.set` sends no bulb traffic: it only writes the persisted file, and the
in-memory mode and `state.desired.mode` change only after that write
succeeds. Because the contract's receipt schema ties `outcome: "sent"` to
`priorEffects: "confirmed-transmission"` with no valid combination for
"succeeded with certainty, nothing was transmitted", a successful `mode.set`
reports that same pairing; a persisted mode change is its own point of
effect, with no possibility of a lost transmission. A persistence failure
(an unsafe directory, a write error, or the defensive case of `mode.set`
reaching a bulb with no configured root) reports `outcome: "failed"` with
`failure.code: "transport-failure"`, the closest code in the closed set, and
leaves the mode and bulb health unchanged. `onModeChange(deviceId, listener)`
notifies only after a successful `mode.set` and returns an unsubscribe
function.

`paintStatus(deviceId, hsbk)` is the controller's internal absolute status
paint: one zero-duration `LightSetColor` with full HSBK, no `LightGet`, and no
effect on power. It mints its own envelope from the bulb's own current
request ID, revision and generation, sharing the same queue,
generation-cancellation and receipt shape as any admitted command. It is not
listed in `lighting.pending`, which the `lifx-light` 1.0.0 snapshot cannot
express (#450); its receipt still reaches `lastOutcome` and
`lastSuccessfulSend`. Its private command kind is never
accepted by `parsed()`/`submit()` or the public lighting schema, so no
external caller can reach it. A paint that loses a race for queue capacity is
a failed attempt and is not retried. An unqualified bulb rejects it outright,
as `unsupported-capability`, with no traffic and no pending entry — defense
in depth, since the publisher never calls it for an unqualified bulb anyway.

`LifxStatusPublisher` (`src/status-publisher.ts`) uses this internal paint to
show one shared agent-state owner's status on every configured qualified
bulb, reading the feed through `@jimmie-potts/agent-status`'s `HubStatusFeed`
and `highestStatus` on the same 30-second/3-second cadence Tidbyt's status
publisher uses. Every shown root session counts with the state the shared
owner reports, whatever its freshness: a finished turn waiting to be read is
idle and soon `uncertain`, yet still done until acknowledged (#439). Only an
unavailable feed or a collector that is not running is `unknown`, which paints
nothing and keeps the last appearance. It paints only on a shown-state
transition: never a heartbeat, an unchanged snapshot, a repeated read or a
timer. The shown key advances to the attempted target regardless of the
paint's outcome, so a failed paint is not replayed; the next transition is a fresh request for the
current state. Painting requires Work or Quiet; Free never paints and leaves
the bulb alone. Quiet paints only attention, at its own cap; everything else
collapses to "nothing to paint" under Quiet, so leaving attention writes
nothing. Entering Work or Quiet resets the key, so the current state paints
once. Colors come from `@jimmie-potts/agent-status`'s shared `STATUS_COLORS`
(the same colors Tidbyt's ASK/RUN/DONE rows use); idle is warm white 2700 K
at zero saturation. Brightness uses the bulb's configured cap (default 50%),
or its quiet cap (default 20%) for Quiet's one painted state. One bulb's
failed paint never blocks another bulb's paint or the next evaluation.

## Source checks

Use Node 24, `npm ci`, `npm run build`, `npm run typecheck` and `npm run test:lifx`
from the repository root, plus the shared checks in
[development](../../docs/development.md#lifx-controller-checks), including
`npm run test:agent-status`.
Tests inject fake transports and sockets; they use synthetic documentation IPs.
Every test that constructs a controller or a status publisher passes its own
temporary `modeStateRoot`, never the real default under a developer's home.
Real installation, bulb traffic and visible acceptance need separate authority.
