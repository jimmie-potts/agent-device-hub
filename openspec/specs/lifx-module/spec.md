# lifx-module Specification

## Purpose
Define the LIFX runtime module under ADR 0012 (Hub #928): its configured bulbs and qualified controls, the cutover's conversion of the old host's configuration and modes, its device and color records, commands answered with stored outcomes that are never sent again, one queue and writer lease per bulb, automatic agent status from the core's sessions, policy A for bulbs it cannot reach, its diagnostics, and the simulated bulbs that its tests, catalog scenario and disposable runs use. It is source verified with simulated bulbs; installation and the physical check belong to the cutover (#840).

## Requirements

### Requirement: Configured bulbs and qualified controls

The LIFX module SHALL be a runtime module named `lifx`, written for module API `1.1` and importing only the SDK and the contracts packages. Its `configure` SHALL accept 1 to 32 bulbs, each with a routing ID and a unicast IPv4 address, distinct from the others, optional model evidence, optional status caps (integers 1 to 100, defaults 50 and 20) and an optional `initialMode` of `work`, `quiet` or `free`, plus `timeoutMs` (10 to 5000, default 500), `retries` (0 to 3, default 1) and `maxPending` (1 to 32, default 8), and SHALL name the bulbs' IDs as its devices. It SHALL refuse anything else with `invalid-request` and fixed text that repeats no value from the section. Only LIFX A19 vendor 1, product 27 on firmware 2.90 SHALL be qualified; any other bulb SHALL be listed with no controls and never reached. No message, log record, health entry or error body SHALL carry a bulb's address. The cutover's conversion SHALL turn the old local controller host's `lifx` block and its `modes/` folder into the module's section: every bulb keeps its address and model evidence, a qualified bulb keeps its mode as `initialMode`, a bulb keeps its status caps only when the block configured the status feed too, the queue bounds carry over, a device ID that is not a routing ID is renamed and reported, and the result passes the module's own `configure`. Reading the old mode files SHALL keep the old controller's fail-closed rules: a linked file, a folder or file others can read, a missing file or invalid JSON reads as Free.

#### Scenario: A valid section
- **WHEN** the runtime's check reads a section with the qualified pendant and the Beam
- **THEN** it accepts the section, the module's devices are the two IDs, and the defaults apply

#### Scenario: A malformed section
- **WHEN** a section has no bulbs, 33 bulbs, an unknown member, an ID that is not a routing ID, a hostname or broadcast address, a repeated ID or address, a cap of 0, an unknown mode, negative evidence or a bound out of range
- **THEN** each is refused with `invalid-request`, and no refusal's detail holds an address

#### Scenario: The conversion keeps every bulb's address and mode
- **WHEN** the conversion reads an old block with a status feed and four bulbs, and a `modes/` folder holding Work and Quiet for two of them
- **THEN** each bulb keeps its address and evidence, the qualified bulbs start in `work`, `quiet` and `free`, the Beam has no mode, only the bulb with a status block keeps its caps, `Desk_Lamp` becomes `desk-lamp` and is reported, and the module's `configure` accepts the section

#### Scenario: Unsafe old mode files
- **WHEN** a mode file is a link, holds an unknown mode or invalid JSON, or is missing, or the folder is group-readable
- **THEN** that bulb's mode reads as Free

### Requirement: Device records

For each configured bulb the module SHALL publish a `device/2.0` record of kind `lifx` on `bunny.state.device.<id>` and a `lifx-light/2.0` record of its color capabilities and last reading on `bunny.state.lifx-light.<id>`, and serve both families through sync, giving each sync only the families it names. A qualified bulb's record SHALL list power, brightness and the native modes `work`, `quiet` and `free`, and its color record color and 1500 to 9000 K; an unqualified bulb's records SHALL list nothing supported. The record SHALL keep `pendingKinds` in step with `pending`, set `lastTransmission` for every acknowledged write, the module's own status paints included, take observed power and brightness only from a LightGet answer, and report a bulb the module cannot reach as `unavailable`. The bulbs' generation SHALL change epoch at every start, and each accepted command SHALL move the bulb's configuration revision.

#### Scenario: Records after start
- **WHEN** the module starts with the qualified pendant and the Beam
- **THEN** the pendant's record is `available`, in `free`, with an observation from one LightGet, and its color record lists color and temperature; the Beam's record lists no controls and stays `unknown`, and no message or record carries an address

#### Scenario: A sync of one family
- **WHEN** a part syncs only `device`
- **THEN** the module serves the device records alone

### Requirement: Commands with outcomes

Each bulb SHALL answer `power-set`, `brightness-set`, `device-mode-set`, `lifx-color-set` and `lifx-temperature-set` on `bunny.cmd.<family>.<id>`. Before anything is stored or sent the module SHALL refuse a command that fails its family's schema (`invalid-message`), uses another family than its key (`invalid-request`), carries a stale configuration revision or generation (`revision-conflict`), asks for an operation the bulb does not offer (`unsupported-capability`), targets a bulb whose writer lease it does not hold (`unavailable`, with fixed text naming another holder, a lease that is not private or one that could not be opened), arrives while the module stops (`unavailable`, from the bus or the module), finds the bulb's queue full (`capacity`), or reuses a `requestId` from the same source for another command (`duplicate-conflict`). A command whose subject names another bulb than its key never reaches the module: the bus refuses it with `invalid-message` (`bunny-message-profile`, "A message's subject is its key's routing ID"). It SHALL store its record of an accepted command, never the command message, in its own SQLite file before it replies `accepted`, and a store that refuses SHALL refuse the command with `capacity` for a full disk or `internal`, with no effect. A repeat of an accepted command SHALL be accepted again with no second effect. The outcome SHALL go through the module's outbox, stored with the records it changes: an acknowledged write and a committed mode change `succeeded` with `transmitted` evidence; a write without an acknowledgment `uncertain` with `none` and `uncertain-result`; a failure before any write `failed` with `none` and `unavailable`; a command whose own deadline passed before its first packet or its write `failed` with `none` and `expired`, having sent nothing; a command whose work the store could not mark begun `failed` with `none` and `capacity` for a full disk or `internal`, having sent nothing; work the module's stop retired before it reached the bulb `failed` with `cancelled`. A mode change SHALL send nothing to the bulb, and one whose turn comes after its deadline SHALL change nothing. Color and temperature SHALL read the bulb and keep the fields they do not change, and SHALL never turn the bulb on. Each packet SHALL get at most `retries` more attempts with the same absolute payload, and no attempt, the first included, SHALL start after the command's own deadline, which the module SHALL check again just before a read-modify-write's write, with that one reading of the clock deciding the write's first attempt; nothing SHALL send a command again afterwards. The module SHALL mark a command's work begun inside its turn, just before its write, and never for a command that expired. At each start the module SHALL report each accepted command its records show without an outcome: `uncertain` when its write had begun, `failed` with `cancelled` when it never had, as for a command that still waited in the queue, and it SHALL never run it again. It SHALL report those of the bulbs whose lease it holds, of a bulb no longer configured and of a bulb whose lease it could not take for another reason than another holder, and SHALL skip only those of a bulb whose lease another holder has, which may still have the work in hand.

#### Scenario: A mode command
- **WHEN** the operator sets the pendant to `quiet`
- **THEN** the record shows the command pending, the outcome is `succeeded` with `transmitted`, the record shows `quiet` with nothing pending, the bulb got no packet, and the mode survives a restart

#### Scenario: Color, temperature, brightness and power
- **WHEN** the operator sets hue 120 at full saturation, then 2700 K, 40% and off
- **THEN** each outcome is `succeeded` with `transmitted`, the bulb shows hue 120, full saturation, 40%, 2700 K and off, and each command moved the configuration revision

#### Scenario: A timeout is uncertain once and never retried
- **WHEN** the pendant drops off the network and the operator switches it off
- **THEN** the module sent the write twice, the outcome is `uncertain` with `none` and `uncertain-result`, reported once, and no later wait or restart sends it again; a command whose deadline passes during its first attempt gets no retry

#### Scenario: An outcome stored before a crash
- **WHEN** the module crashes after storing an outcome and before publishing it, and starts again twice
- **THEN** the outcome goes out once at the first restart, its publication is recorded once, nothing goes out at the second, and the bulb got the write once

#### Scenario: An outcome the store could not keep
- **WHEN** the disk fills while a write is out, so its outcome cannot be stored, and the module starts again twice once the disk has room
- **THEN** the records keep the command pending, the first start reports it `uncertain` with `uncertain-result`, the second reports nothing more, and the bulb got the write and its one retry only

#### Scenario: A stop that cuts work short
- **WHEN** the module stops while a power write is in flight and a color command waits behind it
- **THEN** after the next start the write is `uncertain` and the color command `failed` with `cancelled`, each reported once, and the color command never read the bulb

#### Scenario: A command past its deadline
- **WHEN** a power command and a mode change with 300 ms deadlines wait behind a write to an unreachable pendant, and a color command's LightGet is answered only after its deadline
- **THEN** each ends `failed` with `none` and `expired`, the waiting commands send nothing and the mode stays `free`, and the color command never sends its write; the commands that expired waiting have no `command.executing` record, and no expired job's work is marked begun

#### Scenario: A crash with work in the queue
- **WHEN** the runtime dies while a power write waits for its answer and a color command waits behind it, and the module starts from the database as the crash left it
- **THEN** the power write is reported `uncertain` and the color command `failed` with `cancelled`

#### Scenario: Work the store cannot mark begun
- **WHEN** the store refuses to mark a power command's work begun
- **THEN** the command ends `failed` with `none` and `internal`, the bulb gets no packet, and one storage record is logged

#### Scenario: Unfinished commands of a bulb no longer configured or not leasable
- **WHEN** the runtime dies with a pendant write in flight and a color command waiting, and the next start either has no pendant in its configuration or finds the lease folder readable by others
- **THEN** that start reports the write `uncertain` and the color command `failed` with `cancelled`, and a later start reports nothing more

#### Scenario: One reading of the clock before a write
- **WHEN** a clock moves on by 1 ms at every reading and a power command's deadline falls on the reading after the check before its write
- **THEN** the write goes out and succeeds, and its work is marked begun once

#### Scenario: A second instance on the same state directory
- **WHEN** a second instance starts on the module's state directory while the first has a write in flight to a bulb whose lease it holds
- **THEN** the second reports none of the first's commands, and the first reports its own command once

#### Scenario: A command while the module stops
- **WHEN** a command arrives once the module's stop has begun
- **THEN** it is refused `unavailable` and has no outcome

#### Scenario: A full store
- **WHEN** the module's SQLite file cannot grow and the operator switches the pendant
- **THEN** the command is refused with `capacity`, no packet goes out, there is no outcome, one storage record is logged, the bulb's next record shows the configuration revision, desired values and pending commands as before, and once the file can grow the next command is accepted and one recovery record is logged

#### Scenario: A mode change whose outcome cannot be stored
- **WHEN** the disk fills while a mode change to `work` waits behind a write, so neither outcome can be stored
- **THEN** the bulb's record still shows `free`, and a later status change paints nothing

#### Scenario: Refusals before any change
- **WHEN** commands carry a stale revision or generation, a malformed body, another bulb's subject, a reused `requestId` with another body, or arrive at a full queue
- **THEN** each is refused with its code, another bulb's subject by the bus with `invalid-message` before the module has it, and the bulb gets no packet for any of them

### Requirement: One queue and one writer lease per bulb

Each qualified bulb whose writer lease the module holds SHALL have one queue, the only path to it: one job at a time, at most `maxPending` jobs waiting or running, reservations included, and a LightGet before every brightness, color or temperature write. The module SHALL take each bulb's lease at start as an exclusive transaction on its own file in the module's private folder, refusing a second holder in another process or in the same one, and release it at stop. A bulb whose lease it cannot take SHALL be `unavailable` until the next start, refuse its commands and never be reached, while the module runs on, and the start SHALL log the reason: `busy` for another holder, `unauthorized` for a lease folder or file that is not private, `unavailable` for one that could not be opened. An attempt's deadline and the queue's close SHALL abort the transport's call and wait for the transport to end it. Stopping the module SHALL close each queue: what waits resolves `cancelled` without sending anything, the call in flight is aborted, and the stop SHALL wait for it to end and for the outcomes to commit before the database closes, and only then release the leases.

#### Scenario: A held lease
- **WHEN** another holder in the same process, or a child process, has the pendant's lease while the module starts
- **THEN** the module runs, logs one startup record with reason `busy`, refuses a command to the pendant with `unavailable` and "another writer holds the bulb", reports it `unavailable` and never reaches it; after the holder releases the lease or its process is killed, the next start takes it

#### Scenario: A second take in the same process
- **WHEN** the module holds a bulb's lease and the same process tries to take it again
- **THEN** that take is refused `busy`, and a child process still cannot take the lease

#### Scenario: A lease that is not private or cannot be opened
- **WHEN** the lease folder is group-readable, or a directory stands in the lease file's place
- **THEN** the bulb is `unavailable`, its commands are refused with "the bulb's lease is not private" or "the module could not open the bulb's lease", and the start logs the reason `unauthorized` or `unavailable`

#### Scenario: A stop with a call in flight
- **WHEN** the module stops while a write is in flight and its transport ends the call only later
- **THEN** the bulb's lease stays held until the call ended, and the write's `uncertain` outcome, stored during the stop, goes out at the next start

#### Scenario: The queue's bounds
- **WHEN** a write is in flight with retries pending, more jobs queue behind it, and the queue closes
- **THEN** one exchange runs at a time, a full queue admits nothing more, and every waiting job resolves `cancelled` with no packet

### Requirement: Automatic agent status

The module SHALL sync the core's `session` family and paint each qualified bulb that has status caps from `highestStatus` over its copy, with no acknowledging-consumer filter, so that any consumer's acknowledgment retires `done`. A paint SHALL be one absolute, zero-duration LightSetColor through the bulb's queue, with no LightGet and no change to power. Work SHALL paint the status at the brightness cap; Quiet SHALL paint only attention, at the quiet cap; Free SHALL never paint. The module SHALL paint only when a bulb's shown key changes, never for an unchanged or newer record of the same status, a read or a timer, and SHALL advance the key whatever the paint's result. Entering a mode SHALL reset the key. While the copy has not synced, or after it fails, the status SHALL be `unknown`, which paints nothing, and the module SHALL sync again after 1 s, doubling to 60 s. The key SHALL be kept in the module's SQLite file, so a restart paints nothing while the status stands.

#### Scenario: Status colors
- **WHEN** a session is working, waits for an approval, has a finished turn nobody acknowledged, or none is outstanding, and the pendant enters Work
- **THEN** it paints the shared status color, or warm white 2700 K at no saturation for idle, at the 50% cap, once

#### Scenario: Transitions only
- **WHEN** the core publishes the same status again, newer evidence of it, or a reader reads the bulb, and the LIFX app changes its color
- **THEN** nothing paints until the status changes, which paints once over what the app left

#### Scenario: Quiet and Free
- **WHEN** the pendant is in Quiet and a session raises attention, then another works, then the first is idle; and when it is in Free while sessions change
- **THEN** Quiet paints attention once at its cap and nothing else, and Free paints nothing; returning to Work paints the current status once

#### Scenario: An unsynced copy
- **WHEN** the core does not serve sessions while the pendant is in Work, and later serves them
- **THEN** nothing paints while the status is unknown, one record marks the lost feed, and once synced the current status paints and one record marks the recovery

#### Scenario: A copy that ends after it synced
- **WHEN** the module's copy of the sessions overflows and the core refuses its new sync, and the pendant then enters Work
- **THEN** nothing paints from the sessions the copy last held, one record marks the lost feed, and once the core serves again the current status paints

#### Scenario: A restart
- **WHEN** the runtime restarts while the status stands, and again after it changed while the module was stopped
- **THEN** the first restart writes nothing to the bulb, and the second paints once

#### Scenario: An offline bulb and a full queue
- **WHEN** one of two status bulbs does not answer, or the pendant's queue is full when the status changes
- **THEN** the other bulb paints, the failed paint is not repeated while the status stands, the next transition paints both, and a paint that found the queue full is never sent

### Requirement: Reaching bulbs under policy A

The module's start SHALL open only local resources and SHALL NOT wait on a bulb. It SHALL then read each qualified bulb once with a LightGet, which never changes the bulb, and SHALL never write to a bulb at start. A bulb that does not answer SHALL be `unavailable`, never a module failure, and the module SHALL read it again after 30 s, doubling to 5 minutes, until it answers. Each sync of the module's records SHALL start one LightGet for a qualified bulb whose reading is missing or at least 30 s old, an unavailable bulb included, at most one per bulb every 30 s counting the probe's reads, so a bulb that came back shows `available` within 30 s of a reader's sync. Apart from the start's read and the probe of an unavailable bulb, nothing SHALL read a bulb while nothing reads its records. An outage SHALL log one `device.unavailable` warning and one `device.available` recovery, with later failures summarized at DEBUG at most once a minute. A read SHALL publish only the records it changes: the device record when the bulb's availability, power or brightness changed, the color record when its hue, saturation, brightness or kelvin changed; a read that finds the bulb as it was, or an unanswered read of a bulb already `unavailable`, SHALL publish nothing, and a sync SHALL serve each record as it was last published.

#### Scenario: A bulb unreachable at start
- **WHEN** the module starts while the pendant never answers, and the pendant comes back after half an hour
- **THEN** the start finishes, the record shows `unavailable`, the reads repeat with a doubling wait, one warning and one recovery are logged, and the record shows `available` once the pendant answers

#### Scenario: Reading on demand
- **WHEN** a part syncs the records while the reading is fresh, twice once it is stale, and again after five idle minutes
- **THEN** a fresh reading starts no read, a stale one starts one read however often it is read, nothing reads the pendant while nothing reads its records, and the Beam is never read

#### Scenario: Reads that change nothing
- **WHEN** three on-demand reads find the pendant as it was, then the LIFX app changes its hue, then it drops off the network and is read on demand and by its probe for ten minutes
- **THEN** the three reads publish nothing and a sync serves the last published record, the hue change republishes only the color record, and after the one record that says the pendant is unavailable no read publishes anything

#### Scenario: A bulb that comes back
- **WHEN** the pendant comes back ten minutes into an outage, and a reader syncs the records every 10 s
- **THEN** the pendant shows `available` within 30 s of the first sync, before its next probe

#### Scenario: The kit's policy A check
- **WHEN** the module test kit starts the module with bulbs that never answer
- **THEN** the start finishes within 1000 ms and the module publishes the pendant's record as `unavailable`

### Requirement: Diagnostics

The module SHALL log only events and attributes the diagnostic contract registers for `bunny.module`: `command.executing` when an accepted command's device work begins, at its turn in the bulb's queue within its deadline, so a command that expired waiting has none, the outbox's `outcome.published` and `outbox.deferred`, `DeviceAvailability`'s records, `feed.changed` when a bulb's shown key changes, and one `operation.failed` with one `operation.completed` per run of store failures or lost session syncs. Each call to a bulb SHALL be a `bunny.device.call` span, a command's in the command's trace, and no trace context SHALL reach a bulb. No record SHALL carry an exception's message, a payload or an address.

#### Scenario: A command's span
- **WHEN** the operator switches the pendant
- **THEN** the device call's span is in the command's trace, carries the module's name, and one `command.executing` record names the request

#### Scenario: The kit's records and spans
- **WHEN** the module test kit runs its checks
- **THEN** every record the module logs is one the runtime writes whole, every span has its parent, and the outcome's publication is recorded once across a restart

### Requirement: Simulated bulbs and acceptance tiers

`SimulatedLifx` SHALL answer the LightGet, LightSetColor and DeviceSetPower packets as bulbs would, keep their state across a runtime restart, and let a test take a bulb off the network, lose its next acknowledgment or change it as the LIFX app would; it SHALL reach no bulb. The module SHALL pass the module test kit with its section, its accepted and refused commands, its served and copied families, and policy A's check. The runtime's scenario catalog SHALL hold `lifx-bulbs`, which the in-memory harness runs on both transports and a disposable run plays with the supervisor's simulated bulbs reached over the runtime child's IPC channel: the pendant follows the core's sessions in Work, painting once per change; a restart writes nothing to it; Free never paints it; a color command reaches it; switched off at the wall it shows `unavailable` and a command to it ends `uncertain` in the inbox; and the Beam refuses commands with `unsupported-capability` and gets no packet.

#### Scenario: Tier 1
- **WHEN** `npm run test:runtime:scenarios:built` runs the `lifx-bulbs` scenario in process and through the edge
- **THEN** every step passes and every message follows profile 2.0

#### Scenario: Tier 2
- **WHEN** a reviewer starts a disposable run with `--scenario lifx-bulbs` and captures `scenario-lifx-bulbs`
- **THEN** the capture passes every step and the run's boundary checks

### Requirement: LIFX storage uses SDK full-disk classification
The LIFX module SHALL classify storage errors with the SDK full-disk helper. A wrapped SQLite `SQLITE_FULL` or filesystem `ENOSPC` SHALL retain the existing `capacity` refusal and diagnostic behavior, including refusal before any bulb effect.

#### Scenario: Wrapped ENOSPC refuses command admission
- **WHEN** persisting a command fails with an error caused by `ENOSPC`
- **THEN** the module replies with `capacity`, records no accepted command or outcome, and sends no packet
