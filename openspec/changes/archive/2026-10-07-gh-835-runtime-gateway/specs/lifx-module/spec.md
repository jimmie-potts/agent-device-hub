## MODIFIED Requirements

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
