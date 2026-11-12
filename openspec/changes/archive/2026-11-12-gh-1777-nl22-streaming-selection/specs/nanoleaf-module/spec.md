## MODIFIED Requirements

### Requirement: Interruption, Stop and current-base return

While a session plays, the module SHALL read the light's selection at least once per second and SHALL require the selection that light reports while it streams, the base brightness and power on. That selection SHALL be the light's own: `*ExtControl*` on the Lines and `*Dynamic*` on the NL22 Light Panels, as each installed light reported (#1598, #1777). Any other selection SHALL be a manual change. A live session SHALL end on an explicit Stop, an alert, a newer manual or external change, loss of fresh input or a failed device write or datagram send, and its record SHALL name that reason. Stop, alert and source-loss endings SHALL put a saved-scene base back by name and a colour base back by its hue and saturation or colour temperature, after the base brightness. They SHALL do so only while the device still shows its streaming selection, a scene base is still listed, brightness is unchanged, no newer change exists before and after each write, and the light is on. Otherwise restoration is skipped, or uncertain when a write's answer was lost. Over a base that cannot be selected again, those endings SHALL make no restoration read or write, SHALL leave the last frame and SHALL report restoration `none`. Manual, external and device endings SHALL make no restoration write. A module restart SHALL end a live session as `restart` without a device write or replay. The module SHALL add no device request, write or connection to tell streaming from an unsaved dynamic effect on the NL22. An unsaved dynamic effect picked in the app during an NL22 session is therefore not a recognised manual change, and the module SHALL document that limit (#1777).

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

#### Scenario: Unsaved dynamic effect on the NL22 is not seen
- **WHEN** an unsaved dynamic effect is picked in the Nanoleaf app during an NL22 session, so the Panels report `*Dynamic*` as they do while streaming
- **THEN** the session is not ended as manual, its datagrams continue and are expected to be ignored by a light that left streaming, and a later Stop, alert or source loss puts a scene or colour base back over the effect when brightness is unchanged and the light is on; the README, this specification and the Audio card state this limit

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
