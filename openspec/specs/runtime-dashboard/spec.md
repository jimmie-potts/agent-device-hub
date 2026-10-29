# runtime-dashboard Specification

## Purpose

Define the B.U.N.N.Y. dashboard that the runtime serves (Hub #922), copied from the old Hub's dashboard: its shell, routes, Places and skin, browser sign-in on the runtime's gateway, the agent sessions it syncs from the core and follows live with no polling and no replay, a finished turn shown from the session record alone, and the owner-approved home with its panels. It is source behavior verified in disposable runs; installation happens at the cutover.

## Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub's `apps/dashboard` source remains retained for manual return until separately authorized retirement (#839). The dashboard SHALL keep its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, and the Places links accessible through Settings. The current runtime SHALL use the accepted Quiet glass skin, whose role and private tokens are the only colors its styles use, following light/dark browser appearance. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

#### Scenario: Routes and the shell
- **WHEN** a signed-in page opens Settings, follows the Connections link, goes back, and opens an address that names no page
- **THEN** each page has its hash address, back returns to the preceding page, the unknown address shows that nothing is there with a link home, and nothing is sent

#### Scenario: Accessible pages
- **WHEN** the home and new shell destinations are checked at desktop and 320/390px widths in light/dark appearance and with reduced motion
- **THEN** the changed pages have no WCAG 2.1 A or AA violations, text and controls fit without horizontal overflow, and keyboard focus remains visible

#### Scenario: Fixed attention colors
- **WHEN** a session needs approval or input, or reports a continuing question
- **THEN** approval/input dots and chips use the fixed blocked token, and the continuing question uses the separate question token

### Requirement: Sign-in on the runtime's gateway

The dashboard SHALL sign in only through the gateway's browser routes, with `bunny-request: 1` and its own `Origin` on every change, and SHALL hold no token. On load and on a sign-in click it SHALL use the browser's live session when one exists, so a reload or a second tab opens no new session; without one it SHALL ask for a browser session from trusted loopback or the explicitly configured authenticated home-Wi-Fi or private entry, and when the runtime does not offer one it SHALL show the launcher's page. A `#launch=<code>` fragment SHALL leave the address before the page exchanges the code once. A sign-in that fails SHALL show an alert with the launcher's text. **Disconnect** SHALL end the browser's session, in every tab of the origin, and offer **Sign in**. When the runtime refuses the browser's session, as after a logout elsewhere, an eviction, its expiry or a runtime restart, the page SHALL say the session ended, keep its last records and offer **Sign in again**, and SHALL NOT sign in by itself. A link on another local app's page with the same host name SHALL open the page signed in; a frame from another local app and another host name's link SHALL be refused.

The page's sign-in, launch exchange, logout, session check, authority and Places HTTP calls SHALL each carry valid W3C trace context without changing their authentication protections. With no parent operation, each call SHALL start its own trace.

#### Scenario: Bookmark, reload and second tab
- **WHEN** a fresh browser opens the bookmark on a runtime with trusted loopback sign-in, reloads it, opens a second tab at `#/connections`, and another browser opens it on `localhost`
- **THEN** each page shows the dashboard without a sign-in form, the second tab keeps its address, the first browser holds one session and the other its own

#### Scenario: One password entry behind an authenticated forwarder
- **WHEN** a browser has accepted the forwarder's owner password but has no application session
- **THEN** the startup session check reports an inactive session without an HTTP authentication challenge, the page signs in without requesting the password again, and checking a live session neither replaces it nor extends its expiry

#### Scenario: Context on sign-in and read calls
- **WHEN** the page signs in, exchanges a launch code, signs out, checks its authority or reads Places
- **THEN** every call carries a valid W3C traceparent without a bearer token, tracestate or baggage; independent calls start their own traces and retain the existing cookie, Origin and request-header protections

#### Scenario: The launcher's code
- **WHEN** a runtime without trusted loopback sign-in is opened directly, then the launcher's code opens a tab, and the same code and a malformed one are tried in other browsers
- **THEN** the direct visit shows the launcher's page with no session, the code signs one browser in and leaves the address, and the others show that the launch expired or failed

#### Scenario: Disconnect and an ended session
- **WHEN** one tab disconnects while a second tab of the same browser is open, and later the runtime restarts under an open page
- **THEN** the first tab is signed out with a Sign in action, the second says its session ended and offers Sign in again, neither signs in by itself, and both tabs signing in again reuse one live session, and another Disconnect still ends both tabs

#### Scenario: Existing dashboard through home Wi-Fi
- **WHEN** the owner opens the HTTPS bookmark, navigates at phone width, uses an existing control, briefly disconnects and resumes
- **THEN** the same dashboard and SDK stream show known state, controls retain their existing authorization and tracking, disconnection is visible, recovery resyncs without replay, and no native application or separate mobile interface is required

#### Scenario: Private phone browser recovery
- **WHEN** an owner-authenticated private browser navigates at phone width, uses an existing control, loses connectivity and resumes
- **THEN** the same dashboard resyncs current state without resending the command, and Disconnect ends the session and offers Sign in
- **AND** actual Mac, PC and iPhone home/away and PC-off checks remain installed acceptance rather than an inference from synthetic browser tests

### Requirement: Agent sessions synced from the core

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the activity, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, activity, the age of its last evidence, read evidence, parent and children.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

### Requirement: A finished turn from the session record

The dashboard SHALL show a session's finished turn as **Finished · unread** while its record holds a turn-ended notice that no consumer has acknowledged, no later known turn has started, and no positive read evidence is present. Attention and work SHALL rank above that state. An unknown read state or turn SHALL NOT count as clearing evidence. An acknowledgment from any consumer, positive read evidence or a later known turn SHALL clear it; ending the session SHALL remove its row. The page SHALL never clear a finished turn itself or on a timer, and SHALL offer no row acknowledge button. The Connections operator tool for clearing a notice on every device belongs to #1009.

#### Scenario: Unread until the record clears it
- **WHEN** a session's turn ends and the page stays open for seconds, then another session's new turn starts after its turn ended
- **THEN** the first shows Finished · unread throughout with no command sent, and the second works again with its earlier notice acknowledged by the consumers that clear on a new turn

#### Scenario: Read evidence and a device acknowledgment
- **WHEN** positive read evidence reaches an unread Codex Desktop session, and a device consumer acknowledges another session's unread notice
- **THEN** both rows show idle, the records keep read evidence and acknowledgment distinct, no row acknowledge button is offered, and the page sends no command

#### Scenario: Tier 1 in the catalog
- **WHEN** the catalog's dashboard scenarios run in the in-memory harness over both transports
- **THEN** a browser loads the page and reads the sessions as they appear, an approval is raised and cleared, and the finished turn stays unread for two seconds, clears with a new turn, with any consumer acknowledgment and with positive read evidence, and leaves with its session, never as an inbox item

### Requirement: The approved home with its panels

The home SHALL use the approved responsive glass grid with reusable Hub mode, agent sessions, Inbox and currently selected device, lighting, room and Music cards. The owner's saved desktop or phone arrangement SHALL override default placement through Edit Home; before the first save the built-in arrangement SHALL include the core panels and existing selected module cards. Timeline SHALL remain accessible. Attention SHALL be highlighted on each agent card with an amber surface and written state, without a separate attention panel. The Hub mode card SHALL show the synced saved selection and matching artwork with explicit Work/Free/Quiet controls, including same-mode reapplication. Its concise face SHALL omit routine request sections and device lists; saved choice SHALL remain distinct from device results, with related issues available through its corner Check Inbox control and shared Inbox evidence. The Inbox card SHALL retain #923's synced failed, uncertain and conflicting operations with expandable evidence and explicit handling controls. An empty synced inbox SHALL say that no commands need handling. Both cards SHALL use reusable presentation over existing shared state and adapters.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the default grid holds the Hub mode, sessions and Inbox without a separate attention panel, and the sessions say none were observed

### Requirement: Places on a run

The Places navigation SHALL link a Local place only to the runtime's place link for it (`GET /api/v2/links`), or, on the installed runtime that serves B.U.N.N.Y.'s own place port, to the manifest's address. On any other port, such as a disposable run, a Local place the runtime names no link for SHALL be left out, so a preview never leads to an installed service. Local places SHALL wait for the links.

#### Scenario: A paired run and a run with none
- **WHEN** a run names a link for the wall, and another run names none
- **THEN** the first's Wall leads to the named link in a new tab with the public places unchanged, and the second shows no Local place but B.U.N.N.Y.

### Requirement: Session row label controls

The dashboard SHALL let a person set or clear a session's explicit label from its row using the current synced session revision. It SHALL show requested command, accepted reply and confirmed record evidence separately; an accepted transport answer alone SHALL NOT confirm a label. A conflict SHALL retain the draft and require a refreshed explicit attempt with a new request identity. Stale or disconnected rows SHALL disable submission. Reload and reconnect SHALL show durable labels without resending a command. Ending or replacing a session SHALL retire its editor. Controls SHALL support keyboard use and the dashboard's accessibility checks.

#### Scenario: Label and clear from the row
- **WHEN** a person saves a label and then clears it from a current session row
- **THEN** one command is sent per explicit action, requested and accepted evidence are distinct, and the synced record confirms the label and then its fallback

#### Scenario: Conflict and reconnect
- **WHEN** the row changes while its label draft is open or the stream is lost during submission
- **THEN** the draft remains available, stale submission is disabled, and resync does not resend; a conflict requires a new explicit attempt

#### Scenario: Reload and accessibility
- **WHEN** the person reloads after a confirmed label or uses the row controls with a keyboard
- **THEN** the durable label is displayed without another command, the controls remain usable and the page passes its browser accessibility checks

### Requirement: General controls from named runtime owners
The dashboard SHALL sync device records from each declared owner and operations from the core through its existing SDK participant. It SHALL show desired state, observed state, pending counts/kinds, held state and last successful transmission separately, and keep copies stale until replacement sync completes. It SHALL restore the existing capability-gated general controls and playback view, with no writes for read-only callers.

#### Scenario: Several owners and an unavailable owner
- **WHEN** several modules declare device records and one owner's sync fails
- **THEN** the dashboard shows each owner's records separately, identifies the unavailable owner, retains its stale records and disables its controls without treating its missing reply as device removal

#### Scenario: One guarded general control
- **WHEN** a person deliberately changes a supported device control
- **THEN** one authenticated action-route request carries its target, fresh request ID and the current configuration revision and generation; unsupported values and stale records are refused locally with nothing sent

#### Scenario: Mode and content stay explicit
- **WHEN** Nanoleaf is outside Free or Pixoo is outside Media
- **THEN** content controls refuse without changing mode, while supported power, brightness and explicit native-mode controls remain available under the module's policy

#### Scenario: Capability-gated moments and playback
- **WHEN** a module advertises manual moments or playback controls
- **THEN** the existing manual card sends the selected action through the action route using that family's declared payload, and unavailable playback is never presented as nothing playing

### Requirement: Tracked control states and no replay
The dashboard SHALL distinguish requested, accepted and completed actions using core operation records. It SHALL retain refusals, failures and uncertain results with their effect evidence and request identity. A lost reply or reconnect SHALL NOT cause a write to retry or replay.

#### Scenario: Accepted before completion
- **WHEN** the action route accepts a device command while its module is still working
- **THEN** the card shows accepted and remains locked until operation evidence settles it, and a transmitted success says physical effect was not observed

#### Scenario: Uncertain across reload and refresh
- **WHEN** a command has an uncertain result and the page reloads, reconnects or explicitly refreshes
- **THEN** ordinary controls stay locked, no command is replayed, and a definitive operation outcome can release the lock; a held device remains visibly held until its existing explicit guarded recovery or definitive outcome releases it

#### Scenario: Refused before changing state
- **WHEN** the core refuses a command with a registry error code
- **THEN** the card shows that code and says the request was refused without changing state, distinct from a local refusal where nothing was sent

### Requirement: Declared pages inside the shell
The dashboard SHALL show navigation only for pages declared by current module metadata and open them inside the existing shell. The destination SHALL be the exact same-origin module page path, with no installed service or private-file fallback. Integrated component pages SHALL render only when both the built frontend contribution and the admitted module catalog declare the same module/page. The shared shell SHALL supply navigation, common UI/style, connection handling and authenticated API facilities. Feature frontend source SHALL remain owned by its module. Trusted bundled editors SHALL use the validated trusted presentation and asset policy; passive HTML SHALL retain its restrictive frame policy.

#### Scenario: Bookmark and keyboard navigation
- **WHEN** a person opens a declared module hash bookmark or activates its navigation link with the keyboard
- **THEN** the existing browser sign-in succeeds and the declared page appears inside the shell, without sending a device command

#### Scenario: Undeclared or external page
- **WHEN** a hash names an undeclared page or metadata contains an external or malformed path
- **THEN** the dashboard opens no such destination and offers no navigation to it

#### Scenario: Declared frontend absent or unavailable
- **WHEN** a module is unavailable or its declared component has no matching built contribution
- **THEN** the shell shows unavailable without importing an arbitrary URL or sending a command

#### Scenario: Opening and editing a feature page
- **WHEN** a person opens a feature page and edits a local draft before explicitly saving
- **THEN** opening and drafting change no device, media or scene; an authorized save sends one tracked command and distinguishes acceptance from its completed or uncertain outcome

#### Scenario: Connection lost while drafting
- **WHEN** an already mounted integrated page loses its connection while the owner has an unsent draft
- **THEN** the draft and saved context remain visible, disconnection is explicit, and mutation stays disabled until current authority and state return

### Requirement: Small running-build identity
Connections SHALL display the runtime's frozen build revision, package version, build time and dirty status when available, with unknown values stated honestly. The authenticated read SHALL reveal no settings, host paths or credentials.

#### Scenario: A disposable preview build
- **WHEN** the existing disposable runtime serves the dashboard and Connections is opened
- **THEN** the page identifies the serving build without querying Git per request or claiming installation or device acceptance

### Requirement: Confirmed Connections notice override
Connections SHALL offer an Operator tools override labeled `Clear this notice on every device` for a selected session. It SHALL require confirmation against the selected notice and revision, disable submission without current synced session evidence or control authority, and keep the session row passive. Requested state, transport reply, operation completion and acknowledgment evidence SHALL remain distinct. The result SHALL come from matching current operation and session copies, never the accepted reply alone. Reload, reconnect and lost response SHALL send no automatic retry. The override SHALL prove neither provider readership nor physical device success.

#### Scenario: Confirm and observe
- **WHEN** the operator confirms clearing a selected notice
- **THEN** one command is sent and the recorded acknowledgments clear the passive session row, with completion and synced consumer evidence shown separately from acceptance

#### Scenario: Changed selection or unavailable authority
- **WHEN** the notice changes before confirmation, current evidence is unavailable, or the connection is read-only
- **THEN** submission is disabled or refused without silently switching to a new notice

#### Scenario: Keyboard and recovery
- **WHEN** the operator uses the keyboard to confirm or cancel, or reconnects/reloads after a lost reply
- **THEN** focus and accessible status remain usable, and recovery sends no command

### Requirement: Explicit mode selection with separate outcomes

The mode controls SHALL require a current synced selection, a live connection and control authority. Selecting a mode SHALL send once with a new request ID and the current selection revision. A reply SHALL NOT prove device success. The concise panel SHALL keep individual device results in shared Inbox and Timeline evidence, with a corner link for issues. Missing or unsynced evidence SHALL NOT establish device success or resolution. Reload, refresh and reconnect SHALL send nothing. Keyboard access and the changed control's accessibility SHALL be verified.

#### Scenario: Select and reload
- **WHEN** an operator selects Work using the keyboard and reloads after one device succeeds and another fails
- **THEN** Work remains the saved choice, the failed device remains reviewable through Inbox and independent results remain available in Timeline, reload sends nothing and the changed control has no applicable accessibility violations

#### Scenario: Read-only view
- **WHEN** a read-only connection opens the panel
- **THEN** it can read the saved selection and inspect shared Inbox and Timeline results, its mode controls are disabled and it sends nothing

### Requirement: Optional artwork on the existing playback card

The runtime dashboard SHALL use its existing shared Home, Audio and assigned Rooms playback card, also retained on Music deep links, to show optional artwork from the current declared playback owner through authenticated same-origin module content. Only live, synced, available, known playing or paused ready observations from an unambiguous running owner SHALL load an image. The image SHALL be bounded and contained in a stable square above readable title, artist, album and supported controls. Loading, missing, malformed or failed artwork SHALL retain text and existing control authority and operation evidence. The image SHALL be decorative to assistive technology and SHALL add no keyboard stop. Existing role tokens, narrow layout, keyboard focus and accessibility SHALL be preserved. The browser SHALL use no receiver URL, inline image bytes, executable image content or additional acquisition path, and SHALL preserve the current image content security policy.

#### Scenario: Home and Music share current artwork
- **WHEN** an authorized browser visits Home and Music for the current ready observation
- **THEN** both cards show the current bounded image with readable metadata and supported controls, and page entry, navigation and multiple consumers cause no receiver acquisition or command

#### Scenario: Loading and failure preserve the card
- **WHEN** artwork is loading, absent in a 2.0 record, missing, unsupported, invalid or refused
- **THEN** the image area remains stable and text, keyboard focus, supported controls and operation evidence remain usable on desktop and narrow screens

### Requirement: Browser artwork follows current observation membership

The browser SHALL associate each image and its load/error callbacks with the playback owner, record ID, artwork generation and record revision. New metadata or revision SHALL retire the previous image immediately and use a distinct content reference. An old response or callback SHALL NOT reveal earlier artwork beside current metadata. Source handoff, sync loss, stale or unavailable state and unmount SHALL remove the old image; reconnect SHALL load only current eligible membership without replaying a command. Image completion or failure SHALL NOT enable controls or report playback success, and SHALL NOT retry a command or start an image retry loop.

#### Scenario: Delayed A arrives after B
- **WHEN** image A is delayed while observation B becomes current, including identical-title source changes or a candidate replacement in the same generation
- **THEN** A's element is removed before its delayed completion, its callback cannot reveal A, and only B's current reference can become visible

#### Scenario: Lost sync and re-entry
- **WHEN** the playback sync fails, a route unmounts or the session ends while an image is pending, then the page reconnects or re-enters
- **THEN** the old image is absent, later callbacks cannot restore it, controls retain their current-state guards and no command is replayed

#### Scenario: Sonos and freshness fallback
- **WHEN** Sonos is presented with the same title as Sony, or the current record becomes stale, unavailable or inactive
- **THEN** Sony artwork disappears immediately and the card preserves its existing text and uncertainty presentation

### Requirement: One glass Music card across Home Audio and Rooms

Home, the Audio workspace and explicitly selected rooms SHALL reuse the same music presentation and existing playback owner. The card SHALL keep the cover area, title, artist and album visible, omit control tabs, and place audio output beneath previous, play/pause and next controls. Unreported output SHALL remain Not reported. Current capabilities, authority, sync, freshness and tracked-operation evidence SHALL govern every explicit command. Missing artwork SHALL use a neutral fallback without changing command authority. Existing Music deep links and artwork association fences SHALL remain supported.

#### Scenario: A shared presentation
- **WHEN** a current playback record is shown on Home, Audio and one assigned room
- **THEN** each surface uses the same card, current artwork/metadata and supported controls, with no command on mounting or navigation

#### Scenario: Observation becomes stale or unavailable
- **WHEN** playback updates become stale, the copy loses sync or the owner reports unavailable
- **THEN** an exclamation mark and Stale or Unavailable replace Now playing, controls remain disabled until eligible current evidence returns, unavailable metadata is cleared, and no command is retried

#### Scenario: Read-only or unsupported resume
- **WHEN** the session lacks control authority or the current source does not offer play while paused
- **THEN** the card remains inspectable, the unsupported controls cannot dispatch, and the paused source directs the operator to resume from the iPhone

### Requirement: Persistent explicit Music card room placement

The operator SHALL explicitly place logical playback cards in zero or more existing rooms using authenticated revision-guarded metadata saves. Placements SHALL survive browser reload, another browser and runtime restart. The lighting layout SHALL remain the authority for room identities and names. Missing or deleted rooms SHALL not render a music placement. The interface SHALL identify placement as shared-card placement, not speaker selection, speaker location or room-specific audio routing. Stale room/layout copies, read-only authority or an unresolved save SHALL disable editing. Conflicting and uncertain saves SHALL require explicit refresh without replay. Home's existing music placement SHALL remain available independently of room placement.

#### Scenario: Save and recover room placement
- **WHEN** the operator selects an existing room, saves the placement and reloads or restarts the runtime
- **THEN** the same logical music card appears in that room from synced private metadata, and placement sends no playback command

#### Scenario: Room removal or interrupted save
- **WHEN** the room is removed, or a save reply becomes uncertain
- **THEN** a missing room renders no card, and uncertain editing waits for explicit reconciliation without changing playback or retrying the save

### Requirement: Five primary destinations with retained page addresses

The main navigation SHALL contain exactly Home, Habitat, Rooms, Devices and Automation, in that order. Settings SHALL be a separate utility link reachable from every page. Home SHALL link Timeline. Nested brand, component, playback and declared module pages SHALL select Devices as their containing destination; Timeline SHALL select Home; Settings and Connections SHALL select the Settings utility. Existing Home aliases and brand, component, playback, module, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component or Music bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with Devices selected, and history restores the preceding address without replaying a command

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

### Requirement: Devices directory derives from the current catalog

Devices SHALL group available brand, display, Audio, component and declared module destinations within Lighting, Displays, Audio and Other sections. It SHALL derive destinations from existing catalog and record evidence, retain unrecognized modules in the generic group, and expose catalog failure, missing observations or refused modules honestly. It SHALL NOT create capabilities or device observations, independently acquire state or mutate any device during browsing. Existing Home widgets, saved room/Home placements and card adapters SHALL retain their behavior.

#### Scenario: Browse existing devices and feature pages
- **WHEN** the operator opens Devices and selects a category and destination
- **THEN** the corresponding existing card or declared module page opens in the shared shell with its current observations and capability guards, without adding another main-navigation link

#### Scenario: Catalog or control authority is unavailable
- **WHEN** the catalog cannot be read, a module is refused, or a view is stale or read-only
- **THEN** the shell reports the available evidence without inventing destinations or enabling unsupported commands, and passive navigation makes no command attempt

#### Scenario: A retained uncertain attempt crosses navigation
- **WHEN** the operator leaves and returns to a card with an uncertain attempt
- **THEN** the card retains its existing lock and explicit refresh behavior and sends no replay

### Requirement: Reusable concise Wemo card
The dashboard SHALL reuse one Wemo presentation on Home and existing Wemo device routes. Its primary illustration SHALL represent the connected desk lamp with a smaller Wemo plug. Power and Auto-off tabs SHALL retain artwork position and card dimensions at desktop and phone widths. Switching tabs SHALL preserve drafts, send nothing and make inactive controls unavailable to keyboard and accessibility interaction; reduced-motion appearance SHALL remove the flip animation.

Routine controls SHALL omit repeated On/Off observation text, reported-by-plug wording, Smart plug, Armed and the standing warning below Save limit. The selected power button SHALL reflect plug-reported power rather than desired state or command acceptance. Missing observations SHALL not select Off. Stale, unavailable, held and uncertain evidence SHALL remain explicit. A collapsed device evidence disclosure SHALL retain observation age, desired versus observed state, enforcement/run/deadline/attempt evidence and the Hub/reachability limitation without adding a Details or Activity tab.

The card SHALL retain existing control/freshness/capability guards, per-target request identity, independent explicit limit saves, uncertain-operation recovery and no replay. Refresh and explicit hold release SHALL not send power. Weekly schedules SHALL remain in Automation. Illustrations SHALL not claim visible lamp output.

#### Scenario: Switch controls without moving the card
- **WHEN** a person switches Power and Auto-off at a supported desktop or phone width
- **THEN** the same card and artwork retain their geometry, drafts remain intact, only active controls are accessible and no device or settings mutation occurs

#### Scenario: Observe power while a request is pending
- **WHEN** a power command is requested or accepted before a fresh plug report confirms it
- **THEN** the selected button still follows the reported state and the pending or uncertain outcome remains distinct without an automatic retry

#### Scenario: Edit one limit and revisit the card
- **WHEN** a person explicitly saves one plug's duration or enabled state and changes tabs or routes
- **THEN** the existing authoritative limit save remains independent of other plugs and weekly schedules, with no new command on navigation

#### Scenario: Recover uncertain work
- **WHEN** a lost power or settings reply is followed by refresh, navigation or reload
- **THEN** unresolved power work keeps its existing gate, a limit save requires fresh current settings before another explicit attempt, refresh sends no power, and only an explicit qualified hold release clears the device hold without repeating its uncertain power write

### Requirement: Shared agent habitat

The dashboard SHALL offer a Habitat destination at `#/habitat`, showing one connected four-room habitat with ten resident slots over its existing session copy. Eligible observed sessions SHALL retain their resident while present; newest sessions SHALL fill free slots with deterministic ID ties; known children SHALL NOT occupy slots and unknown parentage SHALL NOT be guessed. Overflow SHALL be visible and SHALL NOT evict occupants. Confirmed membership removal SHALL free slots, while disconnected or resyncing evidence SHALL freeze residents without inferred departures. Empty residents SHALL be labelled unassigned and resting. The page SHALL preserve manual swaps, explicit demo mode, per-resident aprons, forty positions, furniture routing and hopping, and the shared dashboard state precedence.

#### Scenario: Ten residents, overflow and arrival
- **WHEN** twelve eligible sessions are observed, reordered and updated, then one assigned session is removed
- **THEN** ten stable distinct residents and two waiting sessions are shown, and only the freed slot admits the next waiting session

#### Scenario: Reconnect and remount
- **WHEN** the stream is lost during movement and the owner pauses motion, reconnects, leaves Habitat and returns
- **THEN** assigned residents freeze without releasing identity, authoritative membership reconciles after sync, local preferences restore, and leaving cancels the old renderer's animation and listeners

#### Scenario: Customization migration
- **WHEN** the owner explicitly imports a supported preview settings file or an invalid/oversized file
- **THEN** valid whitelisted preferences are backed up and applied locally without upload, while invalid input leaves existing preferences unchanged

#### Scenario: Deliberate conversation navigation
- **WHEN** the owner activates a qualified Codex Windows resident twice, or activates a demo/unassigned/unqualified resident
- **THEN** the first activation inspects and the second same-resident activation requests the exact existing conversation only when qualified, with no rapid-click requirement, command, unread acknowledgment or invented destination

#### Scenario: Safe presentation
- **WHEN** Habitat is opened at desktop or phone width, with reduced motion, hidden document or unavailable canvas
- **THEN** status remains readable, controls remain accessible without overflow, motion follows visibility/pause/reduced-motion, and rendering failure does not remove precise session information or crash the dashboard

### Requirement: Consistent reusable card presentation

The runtime dashboard SHALL give existing reusable cards a shared glass frame, responsive padding, card-title hierarchy, tab treatment and footer-link targets across Home and feature destinations. This includes lighting and room/group cards, displays, Music, Wemo, Hub mode, Inbox, Timeline, agent status, Wispr, ONN and Roborock; the optional MicroDuck card SHALL inherit the widget frame without activating a source. Device artwork, domain-specific control-face sizes, fixed tab geometry, attention colors and concise but truthful state wording SHALL remain intact. Styling SHALL NOT change source ownership, command admission, stored layout, collection or device behavior.

#### Scenario: Same card on Home and a feature page
- **WHEN** an existing card is viewed on Home and its brand, device, Audio or Room destination
- **THEN** its frame, title treatment and controls follow the same visual rules, while its artwork and domain-specific controls remain available

#### Scenario: Consistent tabs and corner controls
- **WHEN** the user changes an existing device card's tabs or focuses a corner status control
- **THEN** tabs have a consistent selected treatment and visible keyboard focus, actionable corner controls have clear touch targets, and changing a tab keeps its artwork and control-face geometry stable without sending a product command

#### Scenario: Phone and theme appearance
- **WHEN** the cards are viewed at desktop, 390px and 320px widths in light and dark appearance
- **THEN** padding follows one responsive rule, labels and controls fit without horizontal overflow, footer links have usable targets, and changed content passes applicable WCAG A/AA checks

#### Scenario: Attention and unavailable evidence
- **WHEN** an agent needs input, a source is stale or unavailable, or a control is disabled
- **THEN** the existing written states, fixed attention colors, disabled protections and access to evidence remain distinguishable; shared styling does not make missing evidence appear current or turn an observation into success

#### Scenario: Quiet idle command feedback
- **WHEN** a Music card is opened before any command from that card
- **THEN** its idle face omits routine no-command boilerplate, while later command progress, errors and results remain visible through the existing feedback region

### Requirement: Quiet reusable companion cards
The dashboard SHALL render the same Reachy and MicroDuck cards on Home and their companion pages. Reachy SHALL be an optional Home card; the existing MicroDuck placement identifier and saved Home layouts SHALL remain valid. Each card SHALL keep its illustration mounted while accessible tabs flip only the controls, retain its dimensions across tabs for unchanged content, support reduced motion and remain readable at phone widths. Detailed source evidence and existing companion tools SHALL remain available on the owning pages.

#### Scenario: Place and navigate companion cards
- **WHEN** the operator adds Reachy or MicroDuck through Edit Home and opens their companion pages
- **THEN** the same card design and controls appear without enabling companions or changing existing placements

#### Scenario: Flip controls without moving artwork
- **WHEN** the user switches tabs with a pointer or keyboard on a desktop or phone
- **THEN** only the control face changes, artwork stays mounted, card dimensions remain stable for unchanged content, and reduced motion disables the flip

#### Scenario: Preserve Reachy controls and provenance
- **WHEN** the operator views Latest or changes text, category or social-snooze settings
- **THEN** latest versus saved history remains distinguishable and guarded existing commands report their actual outcomes while detailed provenance, fixtures and coding suggestions remain accessible

#### Scenario: Preserve explicit browser speech lifetime
- **WHEN** a qualified endpoint is explicitly enabled and the user switches card tabs
- **THEN** the same endpoint remains mounted, Stop and Mute retain their distinct effects, and navigation, removal or loss of current state cannot silently enable or replay speech

#### Scenario: Select one stored conversation
- **WHEN** the operator opens Conversation, chooses an eligible stored Reachy–MicroDuck exchange and confirms, cancels or clears the selection
- **THEN** only the existing selection pointer changes on confirmation or clear, history remains retained, and Meaning shows exactly the latest permitted Duck meaning with its original time and provenance

#### Scenario: Current access and state are required
- **WHEN** read/control permission is absent, the connection or copied state is stale, replacement sync begins or a delayed private read becomes obsolete
- **THEN** private Duck content is hidden, affected controls are unavailable, and no stale read restores content or sends a command

#### Scenario: Reads have no output effects
- **WHEN** the user opens either card, browses conversations, changes tabs, reloads or opens separate history
- **THEN** no text enablement, speech, model call, capture or robot action occurs and empty, emotional, unknown-meaning and unavailable states remain distinct
