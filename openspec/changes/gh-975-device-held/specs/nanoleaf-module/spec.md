## MODIFIED Requirements

### Requirement: Nanoleaf device state

The module SHALL serve, through sync as one of the owners of the shared family `device`, which a consumer names as `bunny/modules/nanoleaf` (Hub #967), and publish each device's `device/2.1` record (Hub #975), its wall view (`nanoleaf-wall`) and, for the Lines, the animation options (`nanoleaf-animations`), each only when it changed, so a poll that reads the same power and brightness publishes nothing. The device record SHALL carry the power and brightness the device reported to `GET /state`, as an observation whose time is that of the reading that first showed them, never a desired value or a transport acknowledgment; desired power, brightness and mode; the configuration revision and generation commands guard on; the device's scenes; pending commands with their families; the last outcome; and the last write that reached the device, the module's own paints and writes it answered with an HTTP error included, with the request ID of the command it served if it served one, kept apart from the last outcome and saved, so that an outcome that sent nothing, a poll and a restart SHALL never change it; a change that includes a command's write SHALL be published at once, and a change from paints alone at most once every 5 s, with the first device request that settles after the interval: within one 5 s poll while the device answers, and up to that poll's 1.2 s deadline later once it stops answering. The module SHALL answer a sync with the states of the families it asks for and no other, so a reader may sync any one of them. Its availability SHALL be `unavailable` while the device does not answer; `degraded` while it answers and the module does not present it, because it refuses the module's token, its last pass failed, a hold stops its writes or no worker runs; and `available` otherwise. While a hold after a write that may have reached the device stops its writes, the device record SHALL carry `held` with that write's request ID and the time the hold began, the same after a restart, and the next record after an explicit mode command or a fresh control releases the hold SHALL omit it. The wall view SHALL show whether the last pass failed or no worker runs (`failing`) and whether a hold stops the device's writes (`held`). Neither the device record nor the wall view SHALL hold a favorite or preset name, an address or a credential. The animation options are the one view that lists favorites, by design, since a play request is chosen from them: they SHALL list the module's presets and the saved favorites with their recipes, the patterns, speeds, directions, defaults and bounds, the queued animation, whether saved positions place spatial patterns, and the remembered scene's ID, null when unavailable, and nothing else; favorites stay out of browser projections. Serving a sync SHALL change no row.

#### Scenario: Observed power
- **WHEN** the wall reports power on, then is switched off in its app
- **THEN** the device record shows observed power on, then off, while desired power stays unknown

#### Scenario: Favorites stay out of the read state
- **WHEN** a favorite is saved and a reader syncs the module's families from `bunny/modules/nanoleaf`
- **THEN** the animation options list it with its recipe and the module's presets, and nothing else; the device record and the wall view hold neither its name nor a preset name, and no row changed

#### Scenario: An idle wall
- **WHEN** the wall answers a minute of polls with the same power and brightness
- **THEN** no new device record is published, and the record keeps the observation it published

#### Scenario: Paints and a command write
- **WHEN** a new session's wave paints the wall several times, then a power command is written
- **THEN** each paint shows in the record's last transmission, with no request ID, within 5 s and one poll, the last transmission changes at most once per 5 s while the wall paints, and the power write shows at once with its request ID

#### Scenario: Back after an outage
- **WHEN** the wall answers again after an outage long enough for its status reads to back off to 30 s, and takes Quiet
- **THEN** the next status read comes within 5 s, and the record shows the Quiet level the wall reports

#### Scenario: Outcomes that sent nothing, and a restart
- **WHEN** the record shows a power write, then an acknowledgment, a saved favorite, a mode command while the wall does not answer and an expiry complete, or the module restarts and cancels a waiting command
- **THEN** the last transmission still shows the power write with its request ID, and the polls after the interval republish nothing

#### Scenario: One family alone
- **WHEN** a reader syncs `device`, `nanoleaf-wall` or `nanoleaf-animations` alone from `bunny/modules/nanoleaf`
- **THEN** each sync holds that family's states only, and the module runs on

#### Scenario: A held wall in its device record
- **WHEN** a brightness write's answer is lost, an explicit mode command releases the hold, a later write's answer is lost and a fresh brightness command releases that hold, and, in another run, the module restarts before a write's answer comes
- **THEN** while each hold lasts the device record is `degraded` and its `held` names the held write's request and the time the hold began, the wall view shows `held`, and each record after a release has no `held`; after the restart, `held` names the write the restart found without a result
