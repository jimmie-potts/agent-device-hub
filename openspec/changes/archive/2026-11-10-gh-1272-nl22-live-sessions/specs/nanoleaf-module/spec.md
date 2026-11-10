## RENAMED Requirements

- FROM: `### Requirement: Live Music sessions on Lines through the existing writer`
- TO: `### Requirement: Live Music sessions on the Lines and the NL22 through the existing writer`

## MODIFIED Requirements

### Requirement: Live Music sessions on the Lines and the NL22 through the existing writer

The Nanoleaf module SHALL accept Music lighting work only from the core. It SHALL admit a Start on the Lines or on the NL22 Light Panels, each as its own light, only in Free with no pending mode, no hold, power not switched off by the hub or at the light, no other live session or waiting content on that light, an existing frozen preset that the renderer accepts with that light's saved layout, a saved layout whose every zone that light's stream can address, and a readable current selection and brightness as the base. The base SHALL be a scene saved on the light, a plain colour read from the light's state, or any other selection, which nothing can select again; no scene SHALL be guessed. A refused Start SHALL make no device write, SHALL NOT change mode, and SHALL name the selection it read without a scene name. An admitted session SHALL check, just before streaming, that the light still reports the base's selection and, for a colour base, its colour, and SHALL otherwise end as manual with no write. It SHALL enter the light's external-control streaming mode with the Start's journaled write: version 2 with logical panels on the Lines, and version 1 on the NL22. It SHALL then send each frame as one UDP datagram to the device's configured address, never to an address a reply names. Lines frames go to the fixed version 2 port with two-byte zone IDs. NL22 frames go to the port the entry's answer names, with one-byte panel IDs, a frame count of 1 per panel and a one-byte count. An NL22 entry answer that names no UDP port SHALL fail the Start as transmitted with `unsupported-capability`, with no frame, no hold and no further write. It SHALL render only the newest fresh Music feature for its capture binding inside the device's locked worker, with at most one device request or datagram in flight, at most one frame per 100 ms and no catch-up. While playing, its device HTTP requests SHALL be limited to the external-change check. Each light's session, worker, journal, writes and record SHALL be its own.

#### Scenario: Admission outside the first trial
- **WHEN** work asks to start in Work or Quiet, while held, on a light that is off or reports no readable selection or brightness, with an unknown preset or from a source other than the core
- **THEN** the module refuses before any device write or mode change, and a refusal after the base read names the selection the light reported

#### Scenario: NL22 layout its stream cannot address
- **WHEN** a Start on the NL22 finds a saved layout with a panel ID above 255 or more than 255 panels
- **THEN** the module refuses it `unsupported-capability` before any device request, and nothing is truncated or sent

#### Scenario: Start over any selection
- **WHEN** a Start finds the light on in Free showing a saved scene, a plain colour, an unsaved scene, an effect or the streaming frames an earlier session left
- **THEN** the module admits it over that base, keeping the scene's name, the colour's hue and saturation or colour temperature, or the selection that cannot be selected again, with the brightness

#### Scenario: Paced latest-value rendering
- **WHEN** features arrive faster than ten per second, repeat a sequence, are stale or belong to another generation
- **THEN** only the newest fresh feature is rendered, duplicates and stale or foreign features produce no datagram, and valid silence keeps the session playing

#### Scenario: Streaming entry and frames
- **WHEN** an admitted Start's first fresh feature renders while the light still reports the base's selection
- **THEN** the Start's journaled write puts the light in external-control mode, each later frame is one datagram of the zones' colors, and no HTTP display write or per-frame read follows

#### Scenario: NL22 version 1 stream
- **WHEN** an admitted NL22 Start's first fresh feature renders and the light answers the version 1 entry with a streaming port
- **THEN** each frame goes to that port at the configured address, carrying every triangle by its one-byte panel ID in the saved layout's order with one frame, white 0 and a 100 ms transition, at most one per 100 ms

#### Scenario: NL22 entry answer without a port
- **WHEN** the NL22 answers the version 1 entry with no body, no port, a port outside 1 to 65535 or a protocol other than UDP
- **THEN** the Start fails as transmitted with `unsupported-capability`, the session ends as a device failure with restoration `none`, and no frame, hold or further write follows

#### Scenario: All five effect families on both lights
- **WHEN** a saved level glow, bass pulse, spectrum, traveling wave or ambient preset starts on the Lines or on the NL22
- **THEN** the session is admitted and streams frames over every zone of that light's saved layout, each element's zones sharing a colour, uniform effects lighting every element alike and spatial effects varying across the layout

#### Scenario: Independent lights
- **WHEN** the Lines and the NL22 each play a session, and one of them ends by Stop, an alert, a manual change or a device failure
- **THEN** only that light's session ends and only that light is written or held; the other light's session, writes, hold and record are unchanged unless its own ending applies

#### Scenario: Colour changed before the streaming entry
- **WHEN** a session admitted over a plain colour is about to enter streaming and the light reports another colour or colour mode while still on `*Solid*`
- **THEN** the session ends as manual with restoration `none`, with no streaming entry and no colour write; only a colour base reads the light's state before the entry, and a colour picked between that read and the entry write is replaced by the entry

#### Scenario: Bounded request rate
- **WHEN** a session plays for several seconds with fresh features every 100 ms
- **THEN** its device HTTP reads stay at the once-per-second external check, and its datagrams at no more than one per 100 ms
