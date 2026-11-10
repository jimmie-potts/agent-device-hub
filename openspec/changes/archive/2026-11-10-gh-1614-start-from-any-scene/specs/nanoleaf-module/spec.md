## MODIFIED Requirements

### Requirement: Live Music sessions on Lines through the existing writer

The Nanoleaf module SHALL accept Music lighting work only from the core. It SHALL admit a Start only on the Lines device in Free with no pending mode, no hold, power not switched off by the hub or at the light, no other live session or waiting content, an existing frozen preset that the renderer accepts, and a readable current selection and brightness as the base. The base SHALL be a scene saved on the light, a plain colour read from the light's state, or any other selection, which nothing can select again; no scene SHALL be guessed. A refused Start SHALL make no device write, SHALL NOT change mode, and SHALL name the selection it read without a scene name. An admitted session SHALL check, just before streaming, that the light still reports the base's selection and, for a colour base, its colour, and SHALL otherwise end as manual with no write. It SHALL enter the light's external-control streaming mode (version 2) with the Start's journaled write, and SHALL then send each frame as one UDP datagram to the device's configured address, addressed by the saved layout's zone IDs. It SHALL render only the newest fresh Music feature for its capture binding inside the device's locked worker, with at most one device request or datagram in flight, at most one frame per 100 ms and no catch-up. While playing, its device HTTP requests SHALL be limited to the external-change check.

#### Scenario: Admission outside the first trial
- **WHEN** work asks to start on Panels, in Work or Quiet, while held, on a light that is off or reports no readable selection or brightness, with an unknown preset or from a source other than the core
- **THEN** the module refuses before any device write or mode change, and a refusal after the base read names the selection the light reported

#### Scenario: Start over any selection
- **WHEN** a Start finds the light on in Free showing a saved scene, a plain colour, an unsaved scene, an effect or the streaming frames an earlier session left
- **THEN** the module admits it over that base, keeping the scene's name, the colour's hue and saturation or colour temperature, or the selection that cannot be selected again, with the brightness

#### Scenario: Paced latest-value rendering
- **WHEN** features arrive faster than ten per second, repeat a sequence, are stale or belong to another generation
- **THEN** only the newest fresh feature is rendered, duplicates and stale or foreign features produce no datagram, and valid silence keeps the session playing

#### Scenario: Streaming entry and frames
- **WHEN** an admitted Start's first fresh feature renders while the light still reports the base's selection
- **THEN** the Start's journaled write puts the light in external-control mode, each later frame is one datagram of the zones' colors, and no HTTP display write or per-frame read follows

#### Scenario: Colour changed before the streaming entry
- **WHEN** a session admitted over a plain colour is about to enter streaming and the light reports another colour or colour mode while still on `*Solid*`
- **THEN** the session ends as manual with restoration `none`, with no streaming entry and no colour write; only a colour base reads the light's state before the entry, and a colour picked between that read and the entry write is replaced by the entry

#### Scenario: Bounded request rate
- **WHEN** a session plays for several seconds with fresh features every 100 ms
- **THEN** its device HTTP reads stay at the once-per-second external check, and its datagrams at no more than one per 100 ms

### Requirement: Interruption, Stop and current-base return

While a session plays, the module SHALL read the light's selection at least once per second and SHALL require the external-control selection, the base brightness and power on. A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write or datagram send, and its record SHALL name that reason. Stop, alert and source-loss endings SHALL put a saved-scene base back by name and a colour base back by its hue and saturation or colour temperature, after the base brightness, only while the device still shows the external-control selection, a scene base is still listed, brightness is unchanged and no newer change exists before and after each write, and the light is on; otherwise restoration is skipped, or uncertain when a write's answer was lost. Over a base that cannot be selected again, those endings SHALL make no restoration read or write, SHALL leave the last frame and SHALL report restoration `none`. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay.

#### Scenario: Newer manual change wins
- **WHEN** a scene, brightness, power, mode or moment request arrives during a session, or during its restoration
- **THEN** the session ends as manual and no music or restoration write follows the newer change

#### Scenario: App scene during streaming
- **WHEN** a scene is chosen in the Nanoleaf app at any point after streaming began, including while one of the session's own requests is in flight
- **THEN** later datagrams cannot replace it, the next external check ends the session as manual with no restoration, and the chosen scene stays

#### Scenario: Alert and source loss
- **WHEN** an alert indication appears, or the input expires, is retired or overflows
- **THEN** the session ends with that reason, the guarded base restoration runs for a scene or colour base, and the microphone is never selected

#### Scenario: Colour base returns
- **WHEN** a session started over a plain colour ends by Stop, an alert or source loss while nothing newer took over
- **THEN** the module writes the base brightness, then the colour in one write, and reports `restored`; a Stop completes as transmitted

#### Scenario: Unnamed base keeps the last frame
- **WHEN** a session started over a selection that cannot be selected again ends by Stop, an alert or source loss
- **THEN** no restoration read or write follows, the light keeps the last frame, the ending reports restoration `none`, and a Stop completes as observed

#### Scenario: A missed window is not source loss
- **WHEN** one capture window is missing and the next carries the producer's discontinuity marker while features stay fresh
- **THEN** the session keeps playing, and it ends as source loss only once no fresh feature remains

#### Scenario: Restart
- **WHEN** the module starts with a session still starting or playing
- **THEN** that session ends as restart with no device write

## ADDED Requirements

### Requirement: The light's last read selection in its record

The Nanoleaf module's `nanoleaf-wall` record SHALL show each light's last read selection: whether it is a scene saved on the light, a saved scene's opaque scene ID, the light's own placeholder name when it is one, what a live Music ending over it would put back, and when it was read. It SHALL also show what the latest Music session's ending puts back, with that session's generation. The selection SHALL come only from reads a Start and a playing session already make, with no added device request. No record SHALL hold a scene name. An unchanged selection SHALL keep its read time for at most a minute.

#### Scenario: Selection from existing reads
- **WHEN** a Start reads the light, or a playing session runs its once-per-second check
- **THEN** the light's record shows that selection and its read time, and the session's device requests are unchanged

#### Scenario: No scene names
- **WHEN** the light shows a saved scene, a placeholder or an unsaved scene
- **THEN** the record shows the scene's opaque ID, the placeholder's own name or only that it is unsaved, and never a scene's name
