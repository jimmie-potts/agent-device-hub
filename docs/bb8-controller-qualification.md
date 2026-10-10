# Original BB-8 integration qualification

Design origin: [Hub #603](https://github.com/jimmie-potts/agent-device-hub/issues/603). Investigated 2026-10-09/10 at Hub main
`93e7269b593d6c41b57d8a17a659686a215a0fe1`.

The owner selected the Windows Bluetooth route using existing hardware, with no
additional purchases. This record defines the source design for the first slice;
it establishes no installed Bluetooth or physical robot acceptance. There is no
product behavior change in this documentation delivery, so it introduces no
OpenSpec capability delta. Implemented module contracts and scenarios must be
reviewed through the issue-linked changes before product coding.

## Evidence classes

S = inspected pinned source; D = vendor documentation; H = read-only host
inventory; P = physical robot observation. No P evidence exists in this delivery.
Hardware availability, Node engine declarations and packet acknowledgments are
separate from installed operation and visible effects.

## Sources and reuse

- [spherov2.py](https://github.com/artificial-intelligence-class/spherov2.py/tree/4252ddb1a12a25db725257d66e3e8ec3057dd48b), commit `4252ddb1a12a25db725257d66e3e8ec3057dd48b`: inspect `spherov2/toy/{bb8,ollie,sphero,__init__}.py`, `spherov2/controls/v1.py`, `spherov2/commands/{core,sphero}.py` and `spherov2/adapter/bleak_adapter.py`. MIT, copyright University of Pennsylvania 2020. Retain the license and attribution with a narrow TypeScript port. Do not import its Python service/relay, unbounded queues, listener threads or error handling as the runtime design.
- [Sphero's older JavaScript implementation](https://github.com/sphero-inc/sphero.js/tree/e9010264a7f8fdca46fb304eb9550b96de036626), commit `e9010264a7f8fdca46fb304eb9550b96de036626`: `lib/devices/sphero.js` corroborates command IDs, but its RGB setter uses a fourth persistence byte and defaults it to one. Do not copy that default.
- [Orbotix API revision 1.20](https://s3.amazonaws.com/docs.gosphero.com/api/Sphero_API_1.20.pdf), 2012: a historical protocol source, not BB-8 firmware evidence. It describes sleep parameters and motion timeout in milliseconds. Its older option-bit list differs from the BB-8 reference. The original docs.gosphero fetch timed out; the vendor S3 copy was readable. DeveloperResources links returned 404.
- [Noble fork](https://github.com/stoprocent/noble/tree/b2c31d08b762ed22d0b513162096ffed44a075ce), commit `b2c31d08b762ed22d0b513162096ffed44a075ce`: MIT, TypeScript declarations, Node >=14, N-API builds, Linux HCI and BlueZ D-Bus bindings and native Windows bindings. npm publishes this commit as `@stoprocent/noble@2.8.0`; its downloaded tarball confirms version 2.8.0, matching registry gitHead and integrity `sha512-AceSTxZ+FmerIgBqP69sEq6T0jsqvzS6ou9Uq4dnvDo7LlGvZqLWFMQXD956K3ATo31uA8pyQAzli9MuFcdJ0w==`. The Git source package.json says 1.12.0, which is not a published npm version; the registry read for that version returned E404 before the release identity was resolved. The packaged Windows x64 binding loaded under native Node 24.21.0 in a passive check; cancellation and adapter behavior remain unqualified. The root entry constructs default bindings on import: keep loading behind explicit device access. The Noble constructor starts bindings when its state is read or a stateChange listener is added; do neither on passive page/module entry.
- [ESPHome candidate](https://github.com/scross01/bb8-esphome/tree/ddce77d22eeba645c7623aabcb771accd8b8a3d8): work in progress with `restore_lights_on_connect` defaulting true. Conditional fallback only; no ESP32/HA deployment or firmware change selected.

## Protocol and capabilities

| Area | Source fact | Implementation consequence and remaining evidence |
| --- | --- | --- |
| Original robot | S: `BB8 -> Ollie -> Sphero -> Toy`, inheriting PacketV1; BB-8 name prefix `BB-`; 60 ms command spacing | Accept a configured identity and expected original-BB-8 service/characteristic shape. Never enroll by prefix alone. Other Sphero generations are unsupported. P: firmware and identity still needed. |
| GATT | S: command `22bb746f-2ba1-7554-2d6f-726568705327`; response notifications `22bb746f-2ba6-7554-2d6f-726568705327` | Require both before device commands; compare selected adapter/target, characteristic properties and configured model. Do not expose arbitrary UUID/byte writes. |
| Handshake | S: write ASCII `011i3` to `22bb746f-2bbd-7554-2d6f-726568705327`, then byte `07` to `22bb746f-2bb2-7554-2d6f-726568705327`; install response callback | Connection itself writes to the robot. Track it as an explicit command with effects; no start/page-open connection. Its selected sequence is handshake, one ping (DID 0/CID 01h) and one version read (DID 0/CID 02h, eight-byte response) within the connect budget. Initialization/LED/self-level behavior is physically unknown. |
| Wake | S: inherited `wake()` writes `01` to `22bb746f-2bbf-7554-2d6f-726568705327` | Explicit wake only, if supported by the discovered shape. GATT write completion does not prove responsiveness; an allowed subsequent ping can establish response availability. No assumed power switch. |
| Framing | S: request `FF FF DID CID SEQ DLEN data CHK`; reply `FF FF MRSP SEQ DLEN data CHK`; asynchronous `FF FE ID DLEN-MSB DLEN-LSB data CHK`; checksum complements the byte sum after SOP | Validate framing, positive length, checksum, exact allowlisted payload length and MRSP before treating anything as success. Bound the collector and reject oversized frames. Fragmented/coalesced notifications are normal input. |
| Sequence/queues | S: 8-bit sequence wraps; BLE writes are chunked at 20 bytes; reference has a 10 s waiter and unbounded queues | One packet transaction at a time behind one Windows process lock; separate configurable finite connection, response and command deadlines. Discard old connection callbacks; close a timed-out exchange before sequence reuse can confuse it. Reference limits are not acceptance guarantees. |
| Reference error handling | S: `_execute` calls `_wait_packet` without enabling its optional MRSP check | Do not reproduce this behavior: a nonzero reply is a device refusal/error, never an acknowledged success. Test known and unknown MRSP values. |
| Main/tail LEDs | S: DID 2/CID `20h` sends three RGB bytes; DID 2/CID `21h` sends one brightness byte | Values 0..255. Proposed first encoding is pinned BB-8 RGB-only; fourth-byte form stays an explicitly selected compatibility trial with persistence zero, never an automatic retry/fallback. No physical LED readback is claimed. |
| LED disagreement | D/S: older API and vendor JS use a fourth byte; Python BB-8 uses three | Record firmware/encoding at first physical qualification. Never send persistence=1. Getter reports configured user color in the vendor JS, which need not equal visible LEDs. |
| Power report | S: DID 0/CID `20h`, `>2B3H`: record version, categorical state, voltage in hundredths of a volt, recharge count and time field | Keep the raw record version and values privately. Dashboard shows category and volts with observation time; no calibrated battery percentage or battery-health claim. Reject unsupported record versions/lengths honestly. Historical D calls the time field seconds awake since recharge; do not relabel it battery runtime. |
| Battery notification | S: DID 0/CID `21h` enables/disables; battery asynchronous handler exists | Optional, explicit bounded telemetry setup; not a heartbeat and not authorization to reconnect or move. Baseline first slice may use an explicit refresh instead. |
| Sleep | S: DID 0/CID `22h` accepts two-byte interval, one byte and two more bytes; reference names the latter unknowns. D names wake interval, macro and orbBasic line | Any eventual sleep form must use zero macro/program selectors and an explicit accepted interval; no macros/deep-sleep guessing. Charger-based recovery must be available. Not selected as a first-slice command until firmware compatibility is qualified. |
| Sensor values | S: inherited streaming masks for attitude, accelerometer, gyro, back-EMF and extended orientation/locator/velocity values; signed 16-bit samples and reference conversions | First slice selects power telemetry only; motion phase may select attitude/collision evidence. No absolute location, calibrated speed or collision avoidance claim. Sensor traffic cannot freshen unrelated fields or renew intent. |
| Aim/roll/stop | S: DID 2/CIDs `01h` heading, `02h` stabilization, `30h` roll with speed, heading, mode and reverse. Reference STOP=0, GO=1, CALIBRATE=2; reset-heading toggles stabilization off and on | Motion phase only. Aiming/stabilization are effects needing explicit arming and containment. A stop acknowledgment is not evidence of rest. |
| Firmware timeout | S: DID 2/CID `34h` sets a 16-bit value; persistent options `35h`/`36h` include enable bit `0x10`; temporary setter `37h` also exists. D older API specifies milliseconds and inhibited behavior during certain programs | Neither units on this BB-8 firmware nor enabled/effective behavior is physically qualified. Do not program motion defaults yet. Preserve all unknown option bits as raw 32-bit values; the reference's decoded known flags lose unknown bits and cannot support exact restoration. |
| Unsupported release effects | No selected first-release operation for raw motors, boost, macros, firmware, pairing settings, device name, persistent LED/options, agent-driven motion or speaker audio | Refuse unselected operations before effects. Existing source methods are not an operation allowlist. |

## Host comparison under the no-purchase constraint

H: the established runtime is WSL, with no Bluetooth adapter exposed there.
Windows has an existing USB Bluetooth adapter. The installed WSL kernel has
Bluetooth/LE support but omits the MediaTek-specific driver needed by this
adapter; the Linux BlueZ command/package was not found and its service was
inactive. USB forwarding is available, but forwarding alone does not complete
the Linux driver setup. These are read-only capability observations, not an
attempted attachment failure. Raw host identifiers stay in private evidence.

H: one passive, 30-second-bounded check loaded the integrity-verified package's
Windows x64 N-API binary under an existing native Node 24.21.0 executable. It
found `NobleWinrt` and the required method descriptors, exited zero and did not
construct the class, import the package entry, initialize a radio or invoke a
method. Binary SHA-256:
`8b8021c4e6414879acda6d1afc9edbd2c48dfd87b6b3678b673bde81652eb1d8`.
This supports binary loading only. It proves no live adapter access,
notification/cancellation behavior, Windows-to-WSL reachability or BB-8 operation.
The bounded check and private receipt are retained outside Git; it is not a
product test or an installed helper. Recheck the packaged build on the selected
installation before any radio trial.

Noble's D-Bus `_pickAdapterPath` falls back to the first adapter even when a
requested adapterId is absent. The transport must verify the actual adapter
identity before any target operation and refuse a mismatch, rather than trust
the library option to enforce selection.

[Microsoft USB instructions](https://learn.microsoft.com/en-us/windows/wsl/connect-usb)
and [usbipd WSL instructions](https://github.com/dorssel/usbipd-win/wiki/WSL-support)
describe administrative bind, unprivileged attach and detach. Windows cannot
use an adapter while attached to WSL. Bind persists; attach is lost on WSL
restart. The installed kernel's [config](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.6.87.2/arch/x86/configs/config-wsl)
and [MediaTek driver path](https://github.com/microsoft/WSL2-Linux-Kernel/blob/linux-msft-wsl-6.6.87.2/drivers/bluetooth/btusb.c)
support the driver concern. No failed attach trial occurred.

| Route | Assessment | Cost/qualification still required |
| --- | --- | --- |
| Additional USB adapter | Excluded by the owner | No additional hardware purchases. |
| Existing adapter passed to current WSL | Attachment mechanism exists; sufficient working BLE refuted by current driver configuration | Missing MediaTek support means attach alone is insufficient. Investigating a matching module/custom kernel is a separate host decision and must account for firmware, restart, ongoing updates and Windows Bluetooth outage. |
| Existing adapter through Windows edge | Selected source-design route; native binding load supported, live BLE operation inconclusive | Small TypeScript edge; WSL remains the core. Use SDK authenticated HTTP/SSE with narrowly granted families, one transport owner and bounded loss handling, not a custom TCP relay. Node 24/package qualification and host ownership precede installation. |
| ESP32/HA | Conditional candidate; not selected | Existing hardware/HA and bounded no-replay behavior would need acceptance. No purchase, flash or HA installation authority. |

Native Windows BLE is the selected route. Keep Windows in control of its existing
adapter and use the normal WinRT binding. The [Windows source](https://github.com/stoprocent/noble/blob/b2c31d08b762ed22d0b513162096ffed44a075ce/lib/win/src/ble_manager.cc)
can connect to a configured Bluetooth address without an advertisement scan.
Use that path for the first slice: no broad scan, automatic enrollment, pairing
or driver substitution. Initialization reports an adapter address; verify it
against private configuration before target access, and refuse a mismatch or
unknown identity. This verification still needs live qualification. If the
binding cannot enforce the selected radio/target, hold installation rather than
silently switch adapters.

## Module, gateway and frontend design

The following is the selected implementation design. Family names and payloads
are reserved here; they are not implemented schemas or shipping capabilities.

- `modules/bb8` exports `registration` under SDK ModuleRegistration: factory
  `createBb8Module({transport})`, configured section, local schemas/family checks,
  simulated factory and module-owned scenario contributions. No shared SDK changes
  are proposed. `start` opens only private local state/bus resources. Defer BLE
  import/access to an explicitly admitted connection command.
- One configured adapter and one enrolled original BB-8 per initial module.
  Keep address, adapter identity and qualification data in private configuration;
  bus/public evidence uses a neutral routing ID. No arbitrary address entry in
  commands, guessed target, broad scan or automatic adoption. Missing credentials,
  identity or lease refuses effects. A second Windows helper instance is refused before opening the device; external applications must release the selected robot before a trial. The local lock cannot exclude an unrelated application.
- General `device/2.1` record uses `kind: "bb8"`; all general capabilities are initially unsupported. BB-8-specific LED and wake controls use their own families; unsupported general capabilities
  stay unsupported, including generic power toggles. Read/sync is passive. Link
  state and battery observations have independent times. `held` can represent a
  device fence; it never claims the robot has stopped.
- Profile-2.0 module state family `bb8-robot`: ID/revision, selected
  capabilities, connection state, latest versioned power report and freshness,
  desired LED values, transmission evidence and unknown physical LED state.
  Later motion state includes heading validity, arm generation/expiry, intent
  deadline and uncertain-motion fence. Avoid publishing BLE address/name/raw bytes.
- Initial public command type examples follow the runtime's last-verb mapping:
  `bb8-connect` uses `org.bunny.bb8.connect.requested`; `bb8-led-set` uses
  `org.bunny.bb8-led.set.requested`. First-slice commands: `bb8-connect`, `bb8-disconnect`, `bb8-wake`,
  `bb8-led-set` (main RGB or tail brightness), `bb8-power-refresh`. Each carries
  requestId and applicable configuration/generation guards; type/subject/key
  must match its versioned family. Connect's handshake effects are explicit.
  Sleep and streaming require an accepted extension; no motion command is registered
  by the first slice.
- Later reserved families: `bb8-aim`, `bb8-arm`, `bb8-drive`, `bb8-stop` and a
  bounded motion/collision state family. Exact motion numbers and field schemas
  are settled after first-slice hardware evidence, before motion implementation.
  Stop has its own admission path: no need for valid arm/heading to ask an enrolled
  connected robot to stop; connection/target/authorization still apply.
- One bounded device queue and one in-flight packet. Recheck deadline/guards before
  each effect, with no queued work from a previous connection. An ambiguous write
  completes uncertain; never resend it. Accepted requests and their outcomes are
  persisted in the private module store; only outcomes/state use the SDK outbox.
  Recovery reports failed-before-write or uncertain-after-possible-write and sends
  no device packet. Failed pre-admission persistence refuses with no effect.
- Reuse shared `outcome/2.0` and core history/Command tracking. Valid successful
  PacketV1 reply proves protocol completion and `transmitted` evidence, not visible
  success. An actual response report can provide observed device data. No ambiguous
  result or stale report is presented as current/observed success.
- Refusals: malformed payload `invalid-message`, invalid values `invalid-request`,
  missing target `not-found`, unsupported operation `unsupported-capability`,
  wrong generation `revision-conflict`, absent grant `forbidden`, missing credential
  `unauthenticated`, unarmed/fenced control `invalid-state`, expired command `expired`,
  full queue/store `capacity`, unreachable dependency `unavailable`. Known device
  parameter/unsupported replies map to the corresponding code; unknown failures
  use `internal`. Ambiguous effects use `uncertain-result`. Retryable codes permit
  a new deliberate request after the cause is resolved, never automatic packet replay.
- Follow ADR 0012 and diagnostic profile 1.3 decision records through SDK log/trace:
  command received/refused, accepted/queued/executed/outcome, device availability,
  outbox commit/publication/ack. Preserve command trace through persistence and
  link replayed outcomes to stored context. No unregistered diagnostic events,
  raw library errors, packets, device addresses or tokens on outward surfaces.
- React frontend is browser-only `./frontend`, through SDK context/Command and
  the shell's existing authenticated connection. Page entry/sync reads do not
  connect. Show explicit connection/wake/LED effects, battery category/volts/time,
  unsupported, unavailable, stale and uncertain states; disable unauthorized
  controls. No raw fetch/auth client, new shell, MCP control or automation.
  The existing generic MCP `execute_action` could otherwise reach new public
  command families. Explicitly reject BB-8 families on that MCP path and test
  it; merely omitting module tools is insufficient. Internal helper commands
  also reject all senders except the configured WSL module.

## Windows component boundary

The WSL module remains the owner of `device` and `bb8-robot`, its private store,
public command outcomes and the React page. A new narrowly scoped Windows
component owns the native BLE handle, PacketV1 codec, one transaction at a time,
and its transport-operation receipts. Its private Windows database is never
opened from WSL. Shared SDK/contract dependencies and pure BB-8 types may be
reused; neither component imports another application's implementation.

The runtime statically registers the WSL module's factory, schemas and frontend.
Its real transport reaches the Windows component through SDK `request`,
`subscribe` and `sync`; its simulated transport reaches no radio. The Windows
component uses `connectRemote` to the existing runtime gateway. Starting either
component opens only local state and SDK resources; native loading and target
access occur only after explicit connect admission.

Two shapes were compared by the coordinator, without independent candidate
agents. Moving the whole BB-8 owner to Windows would put state and outbox next
to the radio, but would require a new remote module host and frontend ownership
arrangement. Keep domain ownership in the existing WSL module instead. The cost
is a small typed transport contract with its own receipt recovery. A raw byte/TCP
relay loses admission, identity and uncertainty rules and is rejected.

### Caller and transport contract

The dashboard's existing scoped `Command` sends `bb8-led-set` for its configured
routing ID and current guards. The WSL module validates it and durably accepts
responsibility, then asks its injected transport to execute one LED operation.
The caller knows RGB/tail values and command outcomes, not UUIDs, packets or
Windows addresses. The Windows component validates the operation independently,
records admission before effects and reports a result. The module commits its
public state/outcome before publication. A lost answer leaves it uncertain; it
never repeats the LED operation. Restart can sync already recorded results and
republish outcomes, but cannot execute stored work.

Non-executable type sketch, to become versioned local schemas in product work:

```ts
type Led = {target: 'main'; rgb: [number, number, number]}
  | {target: 'tail'; brightness: number};
type LinkOperation = {kind: 'connect'} | {kind: 'disconnect'}
  | {kind: 'wake'} | {kind: 'power-refresh'} | {kind: 'led-set'; led: Led};
type LinkRequest = {
  requestId: string; operationId: string; parentRequestId: string;
  expectedConfigurationRevision: number;
  expectedHelperEpoch: string; expectedConnectionGeneration: number;
  operationExpiresAtMs: number; operation: LinkOperation;
};
```

The internal SDK `requestId` must equal `operationId`; `parentRequestId` names
the original public command. Integers, bounds and unknown fields are checked at both boundaries. The target
is the configured neutral subject/key; requests cannot supply an address,
adapter, arbitrary UUID, raw bytes, timeout override or persistence flag.
Each public family includes `requestId` and required configuration/generation
guards. `bb8-led-set` adds exactly the discriminated `Led` value; other initial
public families add no operation parameters. Client effect budgets are selected
by the owner implementation, never extended by telemetry or SDK reconnect.

Reserve local schema version 2.0 for public BB-8 families and these internal
families. The WSL module alone answers the five public command families and
serves `device`/`bb8-robot`. Only the Windows component answers
`bunny.cmd.bb8-link-execute.<id>`, with type
`org.bunny.bb8-link.execute.requested`. It serves `bb8-link` for its helper epoch,
connection generation and transport availability, and `bb8-link-result` for
bounded operation results: operation/parent request IDs, result/evidence,
registered error, observation time and selected decoded power/version fields
when present. It reports each internal request through shared `outcome/2.0`.
Each result has `id` equal to its internal operation ID, with that ID as its
subject and routing-key suffix; it also names the configured robot ID. Each
record carries a revision and the helper/connection generations. A result-state
record and its outcome commit together in its private store.
Public operation completion still comes only from the WSL module's outcome.
Do not add arbitrary result fields to shared outcome schemas.

The result family is a bounded syncable receipt set, not a device-state owner.
It stores only selected transport observations. The module consumes those
observations to derive canonical BB-8 state, and neither component stores a copy
of the other's syncable state. Retire result records only after the module
explicitly records consumption through a reserved `bb8-link-recorded` command;
that operation changes local receipt state and sends no BLE traffic. Core
acknowledgment alone does not prove the module received the matching result.
Refuse new work with `capacity` before the receipt set reaches its limit.
Durably keep operation IDs until their effect deadline has passed, even after
consumption, so a duplicate can never execute again. No outcome or result
publication replays device work.

Selected first-slice software defaults, to encode in schemas/configuration and
fixtures: one active operation, at most eight pending operations per robot,
64 unconsumed results, 1 KiB packet collector, 60 ms minimum packet spacing,
20-byte writes, connection/handshake budget 15 s, response budget 2 s and
non-connect operation budget 5 s. These are software bounds, not
observed firmware guarantees. A delayed operation must expire before its first
effect; every later chunk/write rechecks the operation deadline. Admission's
SDK `expiresat`, the accepted operation deadline and the outcome wait are separate.
The helper rejects an already expired admission; after acceptance it enforces
`operationExpiresAtMs` itself. The module caps it by its finite budget. Reject
clock uncertainty before effects and qualify Windows/WSL deadline behavior.

Windows maintains a private operation ID/effect-start record before each first
possible write. A repeated ID returns a no-effect `duplicate-conflict`, never a
second execution. On restart, interrupted records become failed only when no
effect is proven; otherwise uncertain. Neither restart nor reconnect reopens
BLE automatically. Old helper/connection generations refuse new operations,
discard delayed callbacks, and require fresh explicit connect. SDK reconnection
may restore subscriptions and receipts only. A lost SDK stream invalidates queued
operations and ends further device writes; late native completion is recorded as
uncertain or as later definitive evidence, never retried. Motion adds a local
Windows intent timer and priority stop path before it is enabled.

The SDK already supports remote responders and scoped grants, but the current
runtime gateway's `edgePermissions` permits no remote `respond` or `serve`.
The source implementation must add a narrowly configured transport principal
for this helper, using the SDK's existing `EdgePermissions`; it must not widen
ordinary read/control/ingest credentials or browser sessions. This is required
product work, not an already working gateway facility. Name and test its private
credential/configuration in the owning runtime guide before coding.

A private source-bound credential grants the helper only `respond`, `serve`,
`publish` and `subscribe`; keys are limited to the selected internal command,
state/result/outcome keys and its core `outcome-recorded` acknowledgment key.
It cannot request public controls, subscribe to session content or publish core
facts. Browser credentials do not reach internal helper command keys. Grant
checks occur on every call, not only when opening the stream. The helper accepts internal commands only from the authenticated WSL module
source, including receipt consumption. The module
subscribes to the declared helper source and checks epoch, subject, operation ID
and parent request ID before accepting evidence. Refused-before-effect transport
requests fail the public operation with evidence `none`; accepted requests with
lost results are uncertain. Nonzero MRSP after a packet was sent is a failed
outcome with `transmitted` evidence, not a no-effect admission refusal.

Target/adapter IDs and secrets remain in owner-selected private files. Verify
native stdout/stderr handling: the pinned binding can print raw addresses and
errors. Keep those streams private and bounded; outward SDK errors/logs use
registered codes and static text. Trace each internal request from its public
command and preserve links through both private outboxes. Gateway reachability,
normal WinRT adapter ownership, same-user process lock, credentials and packaging
all require installed qualification before radio access. No kernel/driver,
firewall, firmware or personal setting changes are part of this route.

## Finite physical briefs — proposed, not authorized

Inputs for either brief: owner-selected exact robot identity, adapter/route,
operator, explicit sequence permission, installed revision, charge condition,
safe containment, retrieval method and private receipt location. Record firmware
and configuration before testing. Never substitute a name-prefix guess.

### First slice

Bound: one 15-minute session, at most two connection attempts (15 seconds each),
one wake attempt and three LED selections plus one explicitly chosen restoration
selection. At most two explicit power refreshes. No roll/aim/stabilization,
sensor stream, option write, macros, pairing change or firmware update.

Place the robot in an operator-selected non-slip tray/cradle on the floor away
from edges and people. Have its charger ready; do not assume a physical switch.
Connect with only recorded handshake, one ping and one version read per
connection attempt, and wake if explicitly selected. Record
characteristic shape and valid replies before LED writes. Use the RGB-only form
first; a definite unsupported-format refusal may justify a separately selected
four-byte/zero-persistence compatibility trial within the same LED cap. No alternate
form after an ambiguous write. Observe color/tail visibly and compare response
evidence; record power category/volts without percentage claims.

Abort on wrong identity, spontaneous motion, unstable charging, heat, malformed
or mismatched replies, ambiguous effect or repeated connection failure. End writes,
disconnect and retrieve to the charger safely. Restore only the operator-selected
LED baseline; no invented prior color. A sleep comparison needs its own accepted
parameters/recovery. An optional Edu comparison cannot silently install software,
take writer ownership or update firmware.

### Supervised motion

Motion brief is gated on accepted installed first slice and owner-selected numeric
limits. Proposed starting envelope for later approval: one 10-minute session,
three attempts of at most 500 ms at wire speed <=16/255, in a clear floor-level
containment area, operator within retrieval reach. Heading/aim reference and an
observed stopping bound must be selected; these proposals are not qualified limits.

First prove explicit stop and firmware timeout configuration/enable semantics
without general rolling. Retain raw option bitfield and restore/read it exactly
if a separately authorized persistent change is needed. Prefer no persistent
write; do not assume a temporary option has the same bit meaning. No macro/program
may own drive. Unknown or ineffective firmware timeout blocks a loss-of-control
trial and ordinary motion release.

Aim and arm deliberately. Observe initial low-speed heading and stop/release;
confirm rest visually. Only after those pass, use remaining attempts for pointer
cancellation/focus loss and one bounded host/browser-loss case with an already
qualified firmware watchdog and physical containment. Do not intentionally lose
the link during rolling before that protection is observed.

UI intent expiry, controller intent expiry and firmware timeout are distinct.
Telemetry and link activity renew none of them. Restart/reconnect is disarmed;
repositioning invalidates aim. Any uncertain motion fences new rolling while
explicit stop remains available under its target/connection bounds. Abort after
failure to stop, unexpected heading, unknown rest, collision, heat or unstable
power. Retrieve physically and return to charger; acknowledgment never substitutes
for the rest observation. No further attempts after an abort.

## Verification map before product coding

Selected product change names: `gh-604-bb8-led-status` and
`gh-606-bb8-manual-motion` in the assigned local OpenSpec root, to be linked from
their owning issues before creation. #603's qualification document itself has no
implemented behavior delta and needs no invented product spec. It still needs
independent Standards/Specification reviews and Markdown-only CI for source delivery.

Before #604/#606 coding, add owning module README, exact build/type/package/module
checks and CI commands to docs/development.md and root scripts under one coordinator.
Reserve `test:bb8`, `test:bb8:built` and `test:bb8:package` for the module,
and `test:bb8-windows`/`test:bb8-windows:built` for synthetic helper tests. They
do not exist yet; product work must register them and update owning guides/CI
before executable implementation. A separate `test:bb8-windows:native` check
must remain explicitly passive by default, and any radio qualification must
require named target/permission inputs. Required existing
checks include build/type/lint, workflow, affected event/SDK/contract consumers,
runtime both-transport scenario catalog, focused runtime-dashboard browser/axe
checks and disposable independent Acceptance review. The existing command set to retain is `npm run build`, `npm run typecheck`,
`npm run lint:js`, `npm run check:workflow`, `npm run test:workflow`,
`npm run test:events`, `npm run test:events:python`, `npm run test:sdk`,
`npm run test:runtime`, `npm run test:runtime:scenarios`,
`npm run test:runtime-dashboard`, `npm run test:runtime-dashboard:browser` and
`npm run test:runtime:verify`. Run shared controller/consumer checks where
applicable under the SDLC; documentation fixtures alone never validate the
product. No passing product check is claimed here.

- Packet fixtures: split/coalesced/truncated/corrupt/oversized/unknown packets,
  exact power lengths/versions, MRSP nonzero, duplicate/late/wrong sequence and
  old-connection callbacks, bounded buffers and queue deadlines.
- Module kit: private local startup, absent radio never hangs start, passive sync,
  grants/target/lease/guards/allowlist, admission persistence, duplicate requests,
  failed/uncertain completion, restart between outcome commit/publication, core
  acknowledgment and zero BLE replay.
- Both transports: same catalog command contracts, authenticated route to exactly
  one enrolled simulated robot, unavailable/uncertain device isolation, stale
  telemetry and retained consumer compatibility. Negative controls must expose
  missing target checks, incorrect MRSP success and replay.
- Browser/axe: connection/wake effects clear, manual LED/status usable, tracked
  accepted/completed/uncertain outcomes, readonly authority and unavailable motion;
  later pointer/focus/page loss, arming/aim validity and stop access during a fence.
- Disposable Acceptance: installed source fixture only, synthetic target/state,
  observable user controls and retained first-slice behavior. No real radio access.
- Physical first-slice and motion results use the finite briefs above, with private
  originals and sanitized publication summaries. Installed procedure is owned by
  #1037; source-only #604 installation batches with #605 and #606 with #607.

## Implementation and acceptance limits

The selected route makes source implementation possible after reviewed design
and tracker reconciliation. Live adapter identity, native cancellation,
notifications, target connection, firmware compatibility, initial effects and
LED encoding remain unknown until the separately authorized first-slice trial.
An inconclusive or failed trial holds installed acceptance; it never silently
selects a new adapter, alternate encoding, driver, kernel or host.

Motion numbers and watchdog behavior remain decisions for the later motion
phase after first-slice evidence. The source design does not establish a usable
motion release. Installation uses the owning current-runtime procedure; physical
briefs still need the exact target, operator and explicit sequence permission.
