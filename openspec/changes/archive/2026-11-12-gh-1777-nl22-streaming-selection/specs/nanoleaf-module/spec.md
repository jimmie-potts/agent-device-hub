## MODIFIED Requirements

### Requirement: Interruption, Stop and current-base return

While a session plays, the module SHALL read the light's selection at least once per second and SHALL require the selection that light reports while it streams, the base brightness and power on. That selection SHALL be the light's own: `*ExtControl*` on the Lines and `*Dynamic*` on the NL22 Light Panels, as each installed light reported (#1598, #1777). Any other selection SHALL be a manual change. A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write or datagram send, and its record SHALL name that reason. Stop, alert and source-loss endings SHALL put a saved-scene base back by name and a colour base back by its hue and saturation or colour temperature, after the base brightness. They SHALL do so only while the device still shows its streaming selection, a scene base is still listed, brightness is unchanged, no newer change exists before and after each write, and the light is on. Otherwise restoration is skipped, or uncertain when a write's answer was lost. Over a base that cannot be selected again, those endings SHALL make no restoration read or write, SHALL leave the last frame and SHALL report restoration `none`. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay. The module SHALL add no device request, write or connection to tell its own NL22 stream from anything else that reports `*Dynamic*`. Anything that leaves the NL22 reporting `*Dynamic*` with brightness and power unchanged is therefore not a recognised manual change. The module SHALL document that limit, including that its frames keep painting over such a choice if the NL22 still applies them (#1777).

#### Scenario: Newer manual change wins
- **WHEN** a scene, brightness, power, mode or moment request arrives during a session, or during its restoration
- **THEN** the session ends as manual and no music or restoration write follows the newer change

#### Scenario: App scene during streaming
- **WHEN** a scene is chosen in the Nanoleaf app at any point after streaming began, including while one of the session's own requests is in flight
- **THEN** later datagrams cannot replace it, the next external check ends the session as manual with no restoration, and the chosen scene stays

#### Scenario: NL22 session plays on its own streaming selection
- **WHEN** an NL22 session streams and the Panels report `*Dynamic*` with the base brightness and power on at each once-per-second check
- **THEN** the session keeps playing past those checks, its record keeps `*Dynamic*` as the light's selection, and a later Stop, alert or source loss puts a scene or colour base back by the guarded restoration

#### Scenario: App colour or static selection on the NL22
- **WHEN** a plain colour or an unsaved static selection is picked in the Nanoleaf app during an NL22 session, so the Panels report `*Solid*` or `*Static*`
- **THEN** the next external check ends the session as manual with restoration `none`, no datagram follows the ending, nothing is written, and the app's choice stays

#### Scenario: Unseen `*Dynamic*` choice on the NL22
- **WHEN** during an NL22 session something leaves the Panels reporting `*Dynamic*` with brightness and power unchanged: an unsaved dynamic effect picked in the Nanoleaf app, a scene, palette or effect that the app or an integration plays with a temporary display write, or another external-control client that starts streaming to them
- **THEN** the session is not ended as manual and its datagrams continue; if the Panels still apply them, or another client's frames interleave with them, they paint over the choice until Stop, an alert, source loss, a hub choice, a brightness or power change or a module stop; a later Stop, alert or source loss puts a scene or colour base back over the choice when brightness is unchanged and the light is on; the README, this specification and the Audio card state this limit

#### Scenario: Lines streaming selection unchanged
- **WHEN** a Lines session streams and the Lines report `*ExtControl*`, or report `*Dynamic*` after an effect picked in the app
- **THEN** `*ExtControl*` keeps the session playing and `*Dynamic*` ends it as manual with no write, as before

#### Scenario: Alert and source loss
- **WHEN** an alert indication appears, or the input expires, is retired or overflows
- **THEN** the session ends with that reason, the guarded base restoration runs for a scene or colour base, and the microphone is never selected

#### Scenario: Colour base returns
- **WHEN** a session started over a plain colour ends by Stop, an alert or source loss while nothing newer took over
- **THEN** the module writes the base brightness, then the colour in one write, and reports `restored`; a Stop completes as transmitted

#### Scenario: Unnamed base keeps the last frame
- **WHEN** a session started over a selection that cannot be selected again ends by Stop, an alert or source loss
- **THEN** no restoration read or write follows, the light keeps the last frame, the ending reports restoration `none`, and a Stop completes as observed

#### Scenario: Leftover NL22 stream at the next Start
- **WHEN** a Start on the NL22 reads `*Dynamic*` because an earlier session's last frame is still streaming
- **THEN** the base is an unnamed selection with nothing to restore, the record's placeholder is `*Dynamic*`, the session plays past its checks, and its Stop, alert or source-loss ending writes nothing and reports restoration `none`

#### Scenario: A missed window is not source loss
- **WHEN** one capture window is missing and the next carries the producer's discontinuity marker while features stay fresh
- **THEN** the session keeps playing, and it ends as source loss only once no fresh feature remains

#### Scenario: Restart
- **WHEN** the module starts with a session still starting or playing
- **THEN** that session ends as restart with no device write

### Requirement: The light's last read selection in its record

The Nanoleaf module's `nanoleaf-wall` record SHALL show each light's last read selection: whether it is a scene saved on the light, a saved scene's opaque scene ID, the light's own placeholder name when it is one, what a live Music ending over it would put back, and when it was read. It SHALL also show what the latest Music session's ending puts back, with that session's generation. The selection SHALL come only from reads a Start and a playing session already make, with no added device request. No record SHALL hold a scene name. An unchanged selection SHALL keep its read time for at most a minute. When a `/state` read was made with that selection read, the selection SHALL also show what it said of the light's colour: its colour mode, or null when it gave none or an unexpected one, and the whole hue, saturation and colour temperature it reported. A changed colour mode SHALL be kept at once; a change of only those numbers SHALL wait for the same one-minute refresh as the read time. This is a diagnostic for the installed check (#1777). It SHALL NOT end, guard or restore a session, it SHALL add no device request, and the Lines and the NL22 SHALL show it alike.

#### Scenario: Selection from existing reads
- **WHEN** a Start reads the light, or a playing session runs its once-per-second check
- **THEN** the light's record shows that selection and its read time, and the session's device requests are unchanged

#### Scenario: Colour state from existing reads
- **WHEN** a Start's base read, or a playing check's `/state` read while the light reports its streaming value, shows a colour mode with or without a hue, saturation and colour temperature
- **THEN** the light's record shows them with the selection, a selection read with no `/state` read beside it shows none, and the session's reads, writes, frames and ending are the same whatever they show

#### Scenario: Colour state refresh
- **WHEN** the colour mode a check reads differs from the kept one, or only the hue, saturation or colour temperature differs, at every once-per-second check
- **THEN** a changed colour mode is kept and published at once, while a change of only the numbers is kept and published at most once a minute with the selection's read time, so the published numbers may be up to a minute old

#### Scenario: No scene names
- **WHEN** the light shows a saved scene, a placeholder or an unsaved scene
- **THEN** the record shows the scene's opaque ID, the placeholder's own name or only that it is unsaved, and never a scene's name
