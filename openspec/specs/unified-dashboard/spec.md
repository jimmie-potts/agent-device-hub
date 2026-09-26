# Unified dashboard specification

## Purpose

Provide BUNNY's common interface for inspecting shared agent evidence and explicitly controlling supported device integration through the existing owners.

## Requirements

### Requirement: Separate evidence and inspection
The dashboard SHALL expose provider/source identity, attributable parent/children, chosen labels, activity, attention, retained notices, read evidence, observation age and collector health separately. Opening, selecting, filtering and reconnecting MUST NOT mutate devices or mark chats read.

#### Scenario: Attention while work continues
- **WHEN** an active session has attention and an unread notice
- **THEN** activity, attention and notice are independently visible and selection sends no command

#### Scenario: No active task
- **WHEN** the snapshot contains no active sessions
- **THEN** component status and authorized integration controls remain available

### Requirement: Protected explicit integration commands
The dashboard SHALL submit only explicit supported integration operations through the protected owning services, retaining identity, request IDs and controller revision guards. It MUST preserve Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media meanings, show unsupported operations with reasons, and retain user drafts on conflict or uncertain results. Native controller credentials MUST remain server-side.

#### Scenario: Concurrent controller edits
- **WHEN** another client changes a controller after a draft begins
- **THEN** the draft remains visible and its stale revision cannot silently overwrite the new state

#### Scenario: Lost command result
- **WHEN** a submitted command loses its response
- **THEN** the result is uncertain and reconnect does not submit a replacement command

#### Scenario: Explicit notice acknowledgment
- **WHEN** the user acknowledges a retained notice for a configured consumer
- **THEN** only monitor acknowledgment changes and the UI does not claim provider readership or success

### Requirement: Component integration views
Each user-facing component SHALL use common identity, navigation, status, settings and capability/permission-driven controls with optional specialized views. Device status MUST distinguish selected mode, desired/pending state, last successful transmission, failures, freshness and external control. Missing evidence MUST remain unknown. Advanced-editor links MUST be validated and exact previews remain excluded. General controls appear in the same component view only for the capabilities the controller declares.

#### Scenario: Heterogeneous components
- **WHEN** Nanoleaf, Pixoo and a third synthetic component declare different capabilities
- **THEN** each appears in common navigation with only supported authorized actions and explanations for unavailable operations

### Requirement: General device controls
The dashboard SHALL offer power, brightness, saved-playlist selection, the declared playback actions and saved-scene activation inside a component's existing view when the controller v1 snapshot declares that capability and the credential has control scope. Each control MUST submit exactly one valid controller v1 command through the existing hub route. The command MUST carry the request ticket, configuration revision and generation from a controller read taken immediately before sending, and it MUST be sent only when that read still allows the control. The control MUST show the receipt or typed failure with pending, conflict and uncertain states in plain wording that says whether anything changed and never presents transport success as a physical result. A power or brightness draft MUST conflict only when the controller's configuration revision changed after the draft began, not when only the generation advanced. After an accepted result that is not uncertain, the draft MUST clear and the control MUST unlock once the refreshed snapshot arrives, with no further action. A form appears only for a capability the snapshot declares; the undeclared ones MUST be named together in one line. A declared control that is unavailable MUST be disabled with the missing scope or mode named. The dashboard MUST NOT change a mode as a side effect of another command, submit compound writes, restore a previous state automatically, resubmit a rejected command or retry an uncertain command. For a controller whose brightness command is a persisting override, the view MUST present the desired brightness as an override that lasts until the next explicit mode command and MUST show no override as unknown rather than as a value.

#### Scenario: Declared capability with control scope
- **WHEN** the Pixoo snapshot declares power, brightness and media and the credential has control scope
- **THEN** the power, brightness, playlist and playback controls are enabled and each submits one guarded controller v1 command whose outcome is shown

#### Scenario: Nanoleaf power and brightness in every mode
- **WHEN** the Nanoleaf snapshot declares power and brightness and the wall is in Work, Quiet or Free
- **THEN** the power and brightness controls are enabled, each submits one guarded controller v1 command without a mode command, and an accepted brightness is shown as an override that persists until the next explicit mode command

#### Scenario: One-step settings
- **WHEN** a brightness or power change is accepted with an outcome that is not uncertain
- **THEN** once the refreshed snapshot arrives the form shows current values, is unlocked and accepts the next change without another action, and the status says the change was queued, sent or saved without claiming a physical result

#### Scenario: Generation advance between read and send
- **WHEN** the controller generation advances after the view rendered its snapshot but before the user activates a control, while the configuration revision is unchanged
- **THEN** the dashboard reads the controller again, sends exactly one command with the current ticket, configuration revision and generation, and shows no conflict for an open draft

#### Scenario: Generation advance after the fresh read
- **WHEN** the controller rejects a command as `stale-generation` because the generation advanced after the dashboard's fresh read
- **THEN** the status says nothing changed, no command is resubmitted, and the action stays available for another explicit activation

#### Scenario: Missing capability or read-only credential
- **WHEN** a component does not declare a capability or the credential lacks control scope
- **THEN** the undeclared capability has no form and is named in the component's one not-declared line, a declared control is disabled with the missing scope named, and the view remains usable with no observed sessions

#### Scenario: Stale revision and uncertain result
- **WHEN** another client changes the controller's configuration after a draft begins, or a submitted command loses its response
- **THEN** the draft is retained, the conflict or uncertainty is shown, the control stays locked after an uncertain result until the user explicitly reloads current values, and reconnect or resync replays no command

#### Scenario: Screen power semantics
- **WHEN** the user turns the Pixoo screen off or on
- **THEN** the command is submitted in Monitor or Media without changing the mode, and the view explains that screen-off pauses playback and screen-on does not resume it

### Requirement: Content controls gated by status presentation
The dashboard SHALL disable Pixoo playlist selection and playback actions while Pixoo presents agent status in Monitor or a mode change is pending, and SHALL disable Nanoleaf scene activation while the wall presents agent status in Work or Quiet, while a mode change is pending or while the mode is unknown. In each case the view MUST show the reason and offer a one-click explicit switch to Media or Free through the existing mode control. Returning to Monitor, Work or Quiet MUST use the existing mode control. Because the Pixoo controller does not declare controller v1 modes, the Pixoo mode control and the explicit switch SHALL submit the device-owned Pixoo integration extension's mode operation through the hub's existing integration route with that extension's request ID, configuration revision and generation guards; controllers that declare controller v1 modes, including Nanoleaf, keep the controller v1 mode command for both the mode control and the explicit switch. Playlists SHALL be listed by controller-declared ID until the device-owned naming extension is consumed. Scenes SHALL be listed only from the controller v1 `scenes` capability, labelled by the user-chosen names the device-owned integration extension supplies and by ID otherwise; browser and hub configuration MUST contribute no scene identities or names.

#### Scenario: Monitor gating with explicit switch
- **WHEN** Pixoo is in Monitor and the user activates the explicit switch
- **THEN** one mode command to Media is submitted, no playlist or playback command is sent, and the content controls become available only after the Media mode is observed

#### Scenario: Playback in Media
- **WHEN** Pixoo is in Media and the user selects a declared playlist ID or activates a declared playback action
- **THEN** exactly one media command for that ID or action is submitted and its receipt is shown without a mode change

#### Scenario: Work or Quiet gating with explicit Free switch
- **WHEN** the Nanoleaf wall is in Work or Quiet and the user activates the explicit switch
- **THEN** one controller v1 mode command to Free is submitted, no scene command is sent, and scene activation becomes available only after the Free mode is observed with no pending mode change

#### Scenario: Scene activation in Free
- **WHEN** the wall is in Free and the user activates a declared scene
- **THEN** exactly one scene command for that scene ID is submitted, its receipt is shown without a mode change, and the scene is labelled by its user-chosen name when the integration snapshot supplies one and by ID otherwise

#### Scenario: Scene rejected by the controller
- **WHEN** the controller rejects a scene command with a typed failure because its mode changed after the browser observed Free
- **THEN** the typed failure is shown, no command is repeated, and the control stays available for a fresh explicit action

### Requirement: Reconnect without losing intent
The dashboard SHALL obtain authoritative snapshots on resync or expired cursors, reject superseded results, bound reconnect work, preserve focus and drafts for the same session generation, and keep slow/offline device status independent.

#### Scenario: Reconnect during editing
- **WHEN** the stream disconnects or resyncs while a user edits a field and the session generation is unchanged
- **THEN** updated evidence appears without resetting the field or focus or replaying commands

#### Scenario: Missed retirement while editing a task
- **WHEN** a current snapshot replaces a session with a different generation under the same identity
- **THEN** the old task label and acknowledgment drafts are discarded, the new task uses fresh defaults, and no command is submitted
- **AND** unrelated controller drafts and tasks remain intact

### Requirement: Accessible verified candidate
The dashboard SHALL support keyboard navigation, readable contrast, reduced motion and narrow layouts. Verification SHALL use synthetic task bursts, two controller fixtures, concurrent frontend/MCP-equivalent commands and reconnect, retain latency measurements for Hub #30, and require explicit approval of the actual UI before merge.

#### Scenario: Synthetic acceptance
- **WHEN** the candidate is qualified without personal sessions or devices
- **THEN** browser evidence covers inspection without writes, controls, failures, responsive layout and accessibility separately from human and physical acceptance

### Requirement: Local owner browser launch
The dashboard SHALL accept a single-use short-lived launch code from the installation owner's private launcher, remove it from browser history before exchange, and connect with a memory-only scoped bearer. A direct visit SHALL retain the manual credential path. Disconnect SHALL revoke a launcher session and clear browser memory.

#### Scenario: One-click local launch
- **WHEN** the installation owner invokes the launcher against a running Hub
- **THEN** the browser opens the Hub's loopback page, exchanges one code and shows the authorized dashboard without asking the user to type a bearer

#### Scenario: Replay, expiry and reload
- **WHEN** a code is reused, expired or absent, or the page reloads after a successful launch
- **THEN** the page has no automatic authority, provides a clear relaunch path and sends no device command

### Requirement: Explicit same-mode reapply
The dashboard SHALL offer one explicit action to send the active mode again through the existing mode command. For a controller that declares controller v1 modes, including Nanoleaf, **Reapply <mode>** SHALL be available when the observed mode is known and no mode change is pending. It MUST submit exactly one controller v1 `mode.set` for that mode, which ends power and brightness overrides and reapplies that mode's policy. For Pixoo, **Start Monitor** SHALL be available when the integration snapshot shows Monitor configured, presentation not participating and no pending mode change. It MUST submit exactly one Pixoo integration mode operation for Monitor with that extension's guards. It MUST be disabled with the reason while desired screen power is known to be off. Each action MUST read fresh guards before sending, MUST NOT send any other command and MUST NOT be sent automatically. A result reporting that nothing needed reapplying MUST be shown as already in effect.

#### Scenario: Reapply the active Nanoleaf mode
- **WHEN** the wall is in Work with a brightness override and the user activates Reapply Work
- **THEN** exactly one controller v1 mode command for Work is submitted, no other command is sent, and the refreshed view shows no brightness override

#### Scenario: Nothing to reapply
- **WHEN** the controller reports the same-mode command as cancelled with no effects and no failure
- **THEN** the status says the mode is already in effect and nothing was sent, and the action stays available

#### Scenario: Start an inactive Pixoo Monitor
- **WHEN** Pixoo is configured for Monitor but not participating and its screen is not known to be off
- **THEN** Start Monitor submits exactly one integration mode command for Monitor, sends no media command, and disappears once participation is observed

#### Scenario: Screen off
- **WHEN** Pixoo is configured for Monitor, not participating and its desired screen power is known to be off
- **THEN** Start Monitor is disabled and names the screen-off reason

### Requirement: Shared command lifecycle
Draft forms and one-click actions SHALL follow one command lifecycle. Each deliberate activation MUST send at most one request, and a second activation while a command is running MUST send nothing. A device control MUST build its request from a fresh device read; session label and acknowledgment forms keep building from the monitor snapshot their draft started from. A blocked, failed or throwing preparation MUST send nothing, MUST say that nothing changed and MUST leave the control usable. Only an accepted ticket SHALL be watched for a later terminal receipt. A refresh that fails after a command result MUST keep that result, MUST NOT imply that nothing was sent and MUST NOT resend the command. The next explicit activation of a device control MUST read current guards again. No transition SHALL retry a command automatically.

#### Scenario: Failed fresh read before sending
- **WHEN** the device read taken just before sending a device form or action fails
- **THEN** nothing is sent, the status says nothing changed, a form keeps its draft, and once reads recover one explicit activation sends with current guards

#### Scenario: Failed refresh after a result
- **WHEN** a form's or an action's command is accepted and the refresh that follows it fails
- **THEN** the accepted status remains, the control is released, and no command is resent

#### Scenario: Rejected ticket and another client's receipt
- **WHEN** a command is rejected and another client's receipt for the same ticket later appears
- **THEN** that receipt is not shown as this command's outcome

#### Scenario: Double activation
- **WHEN** the user activates a one-click action twice in quick succession
- **THEN** exactly one command is sent

### Requirement: Now playing view
When the caller's credential grants the configured playback source, the dashboard SHALL offer a now-playing view for that source. It SHALL poll the playback snapshot and show the source ID, status, availability, observation age and the title, artist and album the source reports. It SHALL mark a stale snapshot, show no track for an unavailable source and explain an `inactive` source. A caller without the grant SHALL see no playback view. The first version is text only.

#### Scenario: Current track
- **WHEN** the source is available and playing with title, artist and album
- **THEN** the view shows them with status `playing` and the source ID

#### Scenario: Stale and unavailable source
- **WHEN** the snapshot becomes stale and later unavailable
- **THEN** the view marks the last values stale, then shows no track and says the source is unavailable

#### Scenario: No playback grant
- **WHEN** the credential does not grant the playback source
- **THEN** the navigation has no playback entry and the dashboard reads no playback snapshot

### Requirement: Source-bound playback controls
The now-playing view SHALL show a button only for an action that the latest snapshot declares, and only while the caller has control scope and the source is available. It SHALL name why other controls are missing: read-only access, a stale or unavailable source, or an action the source does not declare. While the source is paused it SHALL warn that the title may not change until playback resumes. Each activation SHALL read the snapshot again, then send at most one command bound to the displayed source ID with a new request ID. It SHALL show sent, refused and uncertain outcomes through the shared command lifecycle, lock after an uncertain result until an explicit reload and never retry automatically.

#### Scenario: Declared controls only
- **WHEN** a control-scoped caller views a playing source declaring pause, next and previous
- **THEN** exactly those buttons appear, play does not, and pressing Next sends one next command for the displayed source

#### Scenario: Paused source
- **WHEN** the source is paused and declares next and previous
- **THEN** Next and Previous appear without Pause, with a note that the title may lag until playback resumes

#### Scenario: Read-only caller
- **WHEN** a read-only caller views the source
- **THEN** no control buttons appear and the view says the credential is read-only

#### Scenario: Control no longer declared
- **WHEN** the fresh read before sending no longer declares the action or the source is no longer available
- **THEN** nothing is sent and the view names the reason

#### Scenario: Uncertain command
- **WHEN** the hub reports an uncertain playback result
- **THEN** the view says the result is unknown, locks the controls until an explicit reload and sends nothing more

### Requirement: Tidbyt and LIFX component views

The dashboard SHALL show `tidbyt` and `lifx` components in the common navigation and component view with the generic controls their controller v1 snapshots declare, and SHALL explain each unavailable control. A Tidbyt view SHALL say that its status and now-playing tiles are published by the local host and that it has no supported controls. A LIFX view SHALL read the lighting snapshot and show the observed color with its age, or unknown. It SHALL offer a color control (hue and saturation) and a color-temperature control within the declared kelvin range when the lighting capabilities declare them and the credential has control scope. A LIFX view whose lighting capabilities declare neither SHALL show one line naming that instead of the two forms. Each lighting control MUST send exactly one `lifx-light` 1.0.0 request through the hub's lighting route. That request MUST carry the guards from a lighting read taken immediately before sending, and MUST NOT turn the bulb on or change power or brightness. Results use the same receipt wording, conflict, uncertainty and lock rules as the general controls. Neither view SHALL show an advanced-editor link.

#### Scenario: Available and unavailable controls
- **WHEN** a control credential opens a Tidbyt component whose snapshot declares no capability and a LIFX component whose snapshot declares power and brightness with color and temperature lighting
- **THEN** the Tidbyt view shows one line naming the missing general capabilities and no general-control forms, and the LIFX power, brightness, color and temperature controls are enabled

#### Scenario: LIFX color change
- **WHEN** the user submits a new hue and saturation
- **THEN** the dashboard reads the lighting snapshot again, sends one `lifx.color.set` with that read's guards, and shows the receipt without claiming the bulb's visible color

#### Scenario: Unqualified bulb or read-only credential
- **WHEN** the lighting snapshot declares no color or temperature, or the credential is read-only
- **THEN** an unqualified bulb shows one line for its general controls and one for Lighting, a read-only credential sees the lighting controls disabled with the reason named, and no lighting request is sent

### Requirement: Power control starting value

The Power control SHALL start from the controller's desired power when it is known. Otherwise it SHALL start from the observed power when the snapshot has one, and its hint SHALL show that reading and its age. Otherwise it SHALL start with no selection and a hint that the current power is unknown, so that either On or Off can be sent as one explicit command. The no-selection state SHALL NOT be submittable.

#### Scenario: Unknown power
- **WHEN** a component's desired and observed power are both unknown
- **THEN** the Power control has no selection, says the current power is unknown, and choosing On sends one `power.set` with `on: true`

#### Scenario: Observed off
- **WHEN** desired power is unknown and the observation says the device is off
- **THEN** the Power control starts at Off with the reading's age, and choosing On sends one `power.set` with `on: true`

### Requirement: No dead controls and distinct disabled buttons

The general controls SHALL show a form only for each of power, brightness, media and scenes that the controller v1 snapshot declares, and one line naming the undeclared ones. A component that declares none of them SHALL show only one line saying it has no general controls. Every disabled button in the dashboard SHALL use a distinct disabled style from skin tokens, not transparency alone, and the view SHALL keep passing the automated accessibility scan.

#### Scenario: Status-only component
- **WHEN** the Tidbyt or another component declares no general capability
- **THEN** its view shows one line and no Power, Brightness, Media or Scenes form

#### Scenario: Partly declared component
- **WHEN** a LIFX bulb declares power and brightness only, or the Pixoo declares everything except scenes
- **THEN** only the declared forms appear, followed by one line such as "Not declared by this controller: media and scenes."

#### Scenario: Disabled button
- **WHEN** a control is unavailable
- **THEN** its button's computed background and text colors differ from an enabled button's, and it is not clickable

### Requirement: Read-only Nanoleaf configuration
The dashboard SHALL show the Nanoleaf integration settings, element mapping, task mapping and project color forms only for the operations the `nanoleaf.integration/1.0` snapshot marks supported. One line SHALL name the unsupported ones. A read-only device, such as the NL22 Light Panels, SHALL still show its mode, power, brightness and scene controls from its controller v1 snapshot, with scenes labelled by that device's user-chosen names. The dashboard SHALL NOT send an extension command for an unsupported operation. Maps to [Hub #323](https://github.com/jimmie-potts/agent-device-hub/issues/323).

#### Scenario: Panels next to the Lines
- **WHEN** the Panels' integration snapshot marks all four configuration operations unsupported and the Lines' marks them supported
- **THEN** the Panels view shows Mode, Power, Brightness and Scenes, no configuration form and one line naming the four, while the Lines view keeps every configuration form and no such line

#### Scenario: Commands on a read-only device
- **WHEN** the user activates a scene and applies brightness on the Panels
- **THEN** each sends exactly one guarded controller v1 command for the Panels, and no extension command reaches either device

#### Scenario: Operation withdrawn after render
- **WHEN** a configuration draft is ready and the snapshot read just before sending marks its operation unsupported
- **THEN** nothing is sent, the form is removed and the line names that operation

### Requirement: Page addresses
Every built-in page and every registered component SHALL have a hash address, and the browser's back and forward buttons SHALL walk between them. Built-in pages and registered components SHALL be distinct navigation kinds, so a component alias equal to a built-in page name opens only that component and the built-in page stays reachable. An address that names no page or no registered component SHALL show that nothing is there with a way home. Opening an address SHALL send no command.

#### Scenario: Alias named like a built-in page
- **WHEN** components with the aliases `activity` and `connections` are registered and the user opens each of them and each built-in page
- **THEN** exactly one navigation item is current, only the chosen page or component is shown, and the address distinguishes `#/component/connections` from `#/connections`

#### Scenario: Back button
- **WHEN** the user opens a component page and then presses the browser's back button
- **THEN** the previous page is shown again and nothing is sent

#### Scenario: Unknown address
- **WHEN** the address names a component that is not registered
- **THEN** the page says no such component exists and links to the home

### Requirement: Home widget grid
The home SHALL be a grid of widgets drawn from a catalog. Each catalog entry SHALL declare an ID, a name, a description, its supported sizes, its source kind (a registered controller alias, a hub route or a read-only external source), the reads it needs and whether it offers command actions; a read-only widget has none. The home SHALL show one component widget per registered component with its health, mode, power, brightness and the everyday mode and power actions, rendered by the same controls as the component page, and a link to that page. Attention, collector health and the observed sessions SHALL be widgets in the same grid, and every component widget SHALL start within the first screen at 1,440 px wide. Placement on the home is fixed in this version.

#### Scenario: Whole installation on the first screen
- **WHEN** the owner opens the home at 1,440 px wide with the wall and pixel components registered
- **THEN** each component widget and the sessions widget begin within the viewport, and the widgets reach across the width of the main column

#### Scenario: Quick action from the home
- **WHEN** the owner applies a mode or power change from a component widget
- **THEN** one guarded command is sent with the same guards, wording and lifecycle as the component page's control

### Requirement: Dense component page
A component page SHALL show a one-line status strip with mode, power, brightness, observation age and pending commands, keep its remaining facts behind a Details disclosure, and render every available control as a card in a grid that fills the width. Each card SHALL keep one short visible line, and longer guidance SHALL sit behind a disclosure. Nanoleaf's integration settings and mappings SHALL sit in one Assignments panel and the Pixoo view form in one Monitor panel. At 1,280 px wide the wall page SHALL be under 2,000 px tall. Every control's accessible name, explicit apply action, status sentences, availability reasons and lifecycle states MUST be unchanged by the layout.

#### Scenario: Wall page height
- **WHEN** the wall component page is opened at 1,280 px wide
- **THEN** its full height is under 2,000 px and its controls reach across the main column

#### Scenario: Rare facts on request
- **WHEN** the user opens the Details disclosure
- **THEN** the desired state, pending changes, last transmission, last outcome, external control, fetch age and integration outcomes are shown

#### Scenario: Unchanged control behavior
- **WHEN** the existing browser, matrix, retirement and local-controllers checks run against the dense layout
- **THEN** every command, gating, conflict, uncertain, focus, keyboard, reduced-motion and accessibility check passes with the same status sentences

### Requirement: Skin-owned scale
The application skin SHALL define the spacing and type scale as tokens alongside its color roles, and the layout SHALL read only tokens, so a skin changes values while the layout keeps its semantics.

#### Scenario: Token boundary
- **WHEN** the dashboard's authored styles are checked
- **THEN** no color literal appears outside the skin file and every token the layout reads is defined by the skin
