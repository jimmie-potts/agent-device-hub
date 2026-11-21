# runtime-dashboard Specification

## Purpose

Define the B.U.N.N.Y. dashboard that the runtime serves (Hub #922), copied from the old Hub's dashboard: its shell, routes, Places and skin, browser sign-in on the runtime's gateway, the agent sessions it syncs from the core and follows live with no polling and no replay, a finished turn shown from the session record alone, and the owner-approved home with its panels. It is source behavior verified in disposable runs; installation happens at the cutover.

## Requirements

### Requirement: The dashboard on the runtime

The runtime SHALL serve the B.U.N.N.Y. dashboard (`apps/runtime/dashboard`), copied from `apps/dashboard` with provenance notes that name each copied file, its source commit and what changed, while the old Hub's `apps/dashboard` source remains retained for manual return until separately authorized retirement (#839). The dashboard SHALL keep its hash routes and back-button history, an address that names nothing shown as not found with nothing sent, and the Places links accessible through Settings. The current runtime SHALL use the accepted Quiet glass skin, whose role and private tokens are the only colors its styles use, following light/dark browser appearance. Bounded artwork-derived decorative values SHALL be supported over that skin under the owner's theme preference while fixed state meanings, readable contrast, typography and geometry remain unchanged. It SHALL read only through the runtime's gateway and the SDK, and SHALL poll nothing. Approval and input attention SHALL use the fixed blocked chip token; a continuing question SHALL use the separate question token.

#### Scenario: Routes and the shell
- **WHEN** a signed-in page opens Settings, follows the Connections link, goes back, and opens an address that names no page
- **THEN** each page has its hash address, back returns to the preceding page, the unknown address shows that nothing is there with a link home, and nothing is sent

#### Scenario: Responsive pages
- **WHEN** the home and new shell destinations are checked at desktop and 320/390px widths in light/dark appearance
- **THEN** text and controls fit without horizontal overflow and keyboard focus remains visible

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

The dashboard SHALL keep one copy of the core's `session` family through SDK sync, acting as the browser's session (`bunny/parts/dashboard`), and SHALL follow its live changes. It SHALL read every record through the contracts package's shared session read function. A sync refused as `unauthenticated` or `forbidden` SHALL end the link with no retry. Any other refused sync, or a copy that stops after a later sync failed, SHALL be tried again after 1 s, doubling to 30 s, while the page keeps its last records and marks them stale. After a lost stream the copy SHALL sync again and show the core's current records; nothing the page missed SHALL be replayed and no command SHALL be sent again. Each session row SHALL show, from its record alone, its name (the label, then the title, then the native session ID), its project and client, how long ago the hub last heard from it (the age of the record's `lastEvidenceAtMs` against the page's own clock, in whole minutes, with no polling and no read of its own; Hub #1947), a chip naming attention first, then work, then an unread finished turn under the dashboard policy below, otherwise the work state, in that disclosure its attention items and retained notices with who acknowledged them, and in a native card disclosure its source, session ID, work state, the same evidence age, read evidence, parent and children. A row SHALL be marked uncertain only when its status is `unknown`, its work is unconfirmed or the copy is not synced; silence SHALL NOT mark any row uncertain; its evidence age shows it instead. Habitat and the Connections notice override SHALL use the same rule.

#### Scenario: Sessions appear and an approval is raised and cleared
- **WHEN** a hook observes a session start and a turn, then an approval prompt, then its resolution
- **THEN** the session appears quiet, then working by its title and client, then waits for approval with an amber card and written attention state, with its attention line available on expansion, then works again with no attention, and the page sends nothing

#### Scenario: A reconnect resyncs with nothing replayed
- **WHEN** the runtime ends the page's stream and the hook observes a turn's end and a new session meanwhile
- **THEN** the page syncs again and shows the finished turn unread and the new session, and sends no command

#### Scenario: Silence marks no row, and only unconfirmed work does
- **WHEN** one session waits on a question, one holds an unread finished turn and one works, all three stay silent for ten minutes, and a fourth's work a core restart left unconfirmed
- **THEN** only the fourth row is marked uncertain, silence marks none of the other three, each of the three faces says the hub heard from it ten minutes ago, and the notice override stays available for the finished session

#### Scenario: Evidence age from the page's clock
- **WHEN** the page shows a session whose record's evidence time is 59 seconds, one minute, and one hour and seven minutes before the page's clock
- **THEN** its face reads Heard <1m ago, Heard 1m ago and Heard 1h 7m ago (a closed Home tile drops the leading word), counting up with the page's clock without another read

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

The home SHALL show its hero above the approved responsive glass grid of reusable agent sessions, Inbox and currently selected device, lighting, room and Music cards. The owner's saved desktop or phone arrangement SHALL override default placement through Edit Home; before the first save the built-in arrangement SHALL include the core panels and existing selected module cards. Timeline SHALL remain accessible. Attention SHALL be highlighted on each agent card with an amber surface and written state, without a separate attention panel. The hero SHALL show the synced saved selection as a large word with explicit Work/Free/Quiet controls, including same-mode reapplication. It SHALL omit routine request sections and device lists; saved choice SHALL remain distinct from device results, with related issues available through its Check Inbox control and shared Inbox evidence. The Inbox card SHALL retain #923's synced failed, uncertain and conflicting operations with expandable evidence and explicit handling controls. An empty synced inbox SHALL say that no commands need handling. Both cards SHALL use reusable presentation over existing shared state and adapters.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the hero shows the Hub mode above a default grid holding the sessions and Inbox without a separate attention panel, and the sessions say none were observed

### Requirement: Places on a run

The Places navigation SHALL link a Local place only to the runtime's place link for it (`GET /api/v2/links`), or, on the installed runtime that serves B.U.N.N.Y.'s own place port, to the manifest's address. On any other port, such as a disposable run, a Local place the runtime names no link for SHALL be left out, so a preview never leads to an installed service. Local places SHALL wait for the links.

#### Scenario: A paired run and a run with none
- **WHEN** a run names a link for the wall, and another run names none
- **THEN** the first's Wall leads to the named link in a new tab with the public places unchanged, and the second shows no Local place but B.U.N.N.Y.

### Requirement: Session row label controls

The dashboard SHALL let a person set or clear a session's explicit label from its row using the current synced session revision. It SHALL show requested command, accepted reply and confirmed record evidence separately; an accepted transport answer alone SHALL NOT confirm a label. A conflict SHALL retain the draft and require a refreshed explicit attempt with a new request identity. An unsynced session copy or a pending attempt SHALL disable submission; the session's status, unknown or with unconfirmed work, SHALL NOT, because the label is the owner's own data and the expected-revision guard still refuses a changed record. Reload and reconnect SHALL show durable labels without resending a command. Ending or replacing a session SHALL retire its editor. Controls SHALL support keyboard use.

#### Scenario: Label and clear from the row
- **WHEN** a person saves a label and then clears it from a current session row
- **THEN** one command is sent per explicit action, requested and accepted evidence are distinct, and the synced record confirms the label and then its fallback

#### Scenario: Conflict and reconnect
- **WHEN** the row changes while its label draft is open or the stream is lost during submission
- **THEN** the draft remains available, submission is disabled while the copy is not synced, and resync does not resend; a conflict requires a new explicit attempt

#### Scenario: Reload and keyboard
- **WHEN** the person reloads after a confirmed label or uses the row controls with a keyboard
- **THEN** the durable label is displayed without another command and the controls remain usable

#### Scenario: Label on an uncertain session
- **WHEN** a session's status is unknown or its work is unconfirmed on a synced copy
- **THEN** its label can still be set or cleared, and a matching synced record confirms the label

### Requirement: General controls from named runtime owners
The dashboard SHALL sync device records from each declared owner and operations from the core through its existing SDK participant. It SHALL show desired state, observed state, pending counts/kinds, held state and last successful transmission separately, and keep copies stale until replacement sync completes. It SHALL restore the existing capability-gated general controls and playback view, with no writes for read-only callers. It SHALL take the Pixoo's mode and base from the device's advertised Hub mode and `pixoo-display/2.1`, with no Monitor/Media mapping of its own.

#### Scenario: Several owners and an unavailable owner
- **WHEN** several modules declare device records and one owner's sync fails
- **THEN** the dashboard shows each owner's records separately, identifies the unavailable owner, retains its stale records and disables its controls without treating its missing reply as device removal

#### Scenario: One guarded general control
- **WHEN** a person deliberately changes a supported device control
- **THEN** one authenticated action-route request carries its target, fresh request ID and the current configuration revision and generation; unsupported values and stale records are refused locally with nothing sent

#### Scenario: Mode and content stay explicit
- **WHEN** Nanoleaf is outside Free or the Pixoo reports Work
- **THEN** content controls are disabled with the mode named, a start the module refuses is shown as `invalid-state` from its outcome without changing mode, and supported power, brightness and Hub-mode controls remain available under the module's policy

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
- **THEN** focus and status remain usable, and recovery sends no command

### Requirement: Explicit mode selection with separate outcomes

The mode controls SHALL require a current synced selection, a live connection and control authority. Selecting a mode SHALL send once with a new request ID and the current selection revision. A reply SHALL NOT prove device success. The concise panel SHALL keep individual device results in shared Inbox and Timeline evidence, with a corner link for issues. Missing or unsynced evidence SHALL NOT establish device success or resolution. Reload, refresh and reconnect SHALL send nothing. Keyboard access SHALL be verified.

#### Scenario: Select and reload
- **WHEN** an operator selects Work using the keyboard and reloads after one device succeeds and another fails
- **THEN** Work remains the saved choice, the failed device remains reviewable through Inbox and independent results remain available in Timeline and reload sends nothing

#### Scenario: Read-only view
- **WHEN** a read-only connection opens the panel
- **THEN** it can read the saved selection and inspect shared Inbox and Timeline results, its mode controls are disabled and it sends nothing

### Requirement: Optional artwork on the existing playback card

The runtime dashboard SHALL use its existing shared Home, Audio and assigned Rooms playback card, also retained on Music deep links, to show optional artwork from the current declared playback owner through authenticated same-origin module content. Only live, synced, available, known playing or paused ready observations from an unambiguous running owner SHALL load an image. The image SHALL be bounded and contained in a stable square above readable title, artist, album and supported controls. Loading, missing, malformed or failed artwork SHALL retain text and existing control authority and operation evidence. The image SHALL add no keyboard stop. Existing role tokens, narrow layout and keyboard focus SHALL be preserved. The browser SHALL use no receiver URL, inline image bytes, executable image content or additional acquisition path, and SHALL preserve the current image content security policy.

#### Scenario: Home and Music share current artwork
- **WHEN** an authorized browser visits Home and Music for the current ready observation
- **THEN** both cards show the current bounded image with readable metadata and supported controls, and page entry, navigation and multiple consumers cause no receiver acquisition or command

#### Scenario: Loading and failure preserve the card
- **WHEN** artwork is loading, absent in a 2.0 record, missing, unsupported, invalid or refused
- **THEN** the image area remains stable and text, keyboard focus, supported controls and operation evidence remain usable on desktop and narrow screens

### Requirement: Browser artwork follows current observation membership

The browser SHALL associate each image and its load/error callbacks with the playback owner, record ID, artwork generation and record revision. A new owner, record ID or artwork generation, or a record that stops admitting artwork, SHALL retire the previous image immediately. Every new revision SHALL use a distinct content reference. Within one owner's generation, the loaded picture MAY stay visible while the current revision's reference loads hidden; only that reference's own load SHALL replace it, and its error SHALL show the placeholder. An old response or callback SHALL NOT reveal artwork from another owner or generation beside current metadata, or replace the current reference's result. Source handoff, sync loss, stale or unavailable state and unmount SHALL remove the old image; reconnect SHALL load only current eligible membership without replaying a command. Image completion or failure SHALL NOT enable controls or report playback success, and SHALL NOT retry a command or start an image retry loop.

#### Scenario: Delayed A arrives after B
- **WHEN** image A is delayed while observation B becomes current, including identical-title source changes or a candidate replacement in the same generation
- **THEN** A's element is removed before its delayed completion, its callback cannot reveal A, and only B's current reference can become visible

#### Scenario: A same-generation revision keeps the picture
- **WHEN** a loaded image's record gets a new revision with the same owner and artwork generation, such as a pause or resume
- **THEN** the card requests the new revision's reference, keeps the loaded picture visible with no placeholder until that reference loads, and then retires the earlier image element

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

The main navigation SHALL contain exactly Home, Companions, Rooms, Devices and Automation, in that order. Home, Companions, Rooms and Automation SHALL be links. Devices SHALL be a button that opens the Devices menu, and the menu's "All devices" entry SHALL be the link to the Devices directory at its existing address. Settings SHALL be a separate utility link reachable from every page, placed below the destinations at the bottom of the rail. Home SHALL link Timeline and Audio. Nested brand and component pages and the declared pages of hardware modules SHALL select Devices as their containing destination; Timeline, Audio, the full-window visualizer, the Music source pages and the declared pages of a module that is neither hardware nor companions SHALL select Home, and such a module page SHALL name Home as its parent; Habitat and the companions module's declared pages SHALL select Companions; Settings and Connections SHALL select the Settings utility. Existing Home aliases and Habitat, brand, component, playback, module, Audio, Connections and Timeline addresses SHALL remain valid, including component aliases that match a built-in page name. Navigation links SHALL preserve ordinary anchors, modified clicks and browser history.

#### Scenario: Open an existing bookmark
- **WHEN** the operator opens a brand, module, component, Audio, Music or Habitat bookmark and uses back/forward navigation
- **THEN** the existing page and guarded controls remain usable with its containing destination selected, and history restores the preceding address without replaying a command

#### Scenario: A page outside the hardware inventory
- **WHEN** the operator opens the Art Gallery or another page of a module that is not hardware, from Home, the jump palette, a pin or a bookmark
- **THEN** Home is selected in the rail and named as the page's parent, and Devices is not

#### Scenario: A component is named Devices
- **WHEN** the operator opens `#/component/devices`, `#/component/settings` or an undeclared address
- **THEN** the component route remains distinct from the built-in landing page, and undeclared addresses show not found without attempting a command

#### Scenario: Session recovery stays reachable
- **WHEN** the browser session ends or the operator wants to disconnect
- **THEN** ended-session sign-in remains reachable without an automatic sign-in, and Settings provides Disconnect and the existing connection/operator information

#### Scenario: Open the directory
- **WHEN** the operator opens the Devices menu and chooses "All devices"
- **THEN** the Devices directory opens at its existing address with Devices selected

### Requirement: Devices directory derives from the current catalog

Devices SHALL list the configured hardware only, in Displays, Lighting and Appliances sections: each module that serves or holds device records, or is a known hardware module, as one card. A lighting brand's card SHALL lead to the brand's overview page and list each of its lights directly under it, each opening that light's existing device page. Any other hardware module SHALL be one card that opens its device's page, or list its devices when it has several, or open its first declared page when it holds no device records. Task pages, such as a display's media or a wall's saved shows, SHALL be reached from the device's own page and SHALL NOT be listed. Companion features, Audio and other pages that are not hardware SHALL NOT be listed. It SHALL derive destinations from existing catalog and record evidence and expose catalog failure, missing or stale observations, unavailable devices or refused modules honestly. It SHALL NOT create capabilities or device observations, independently acquire state or mutate any device during browsing. Existing Home widgets, saved room/Home placements and card adapters SHALL retain their behavior.

#### Scenario: Browse existing devices and feature pages
- **WHEN** the operator opens Devices and selects a destination in a category's section
- **THEN** the corresponding existing card or declared module page opens in the shared shell with its current observations and capability guards, without adding another main-navigation link

#### Scenario: Catalog or control authority is unavailable
- **WHEN** the catalog cannot be read, a module is refused, or a view is stale or read-only
- **THEN** the shell reports the available evidence without inventing destinations or enabling unsupported commands, and passive navigation makes no command attempt

#### Scenario: A retained uncertain attempt crosses navigation
- **WHEN** the operator leaves and returns to a card with an uncertain attempt
- **THEN** the card retains its existing lock and explicit refresh behavior and sends no replay

### Requirement: Reusable concise Wemo card
The dashboard SHALL reuse one Wemo presentation on Home in one column and existing Wemo device routes; on Home's unit grid a plug is the press panel. Its primary illustration SHALL represent the connected desk lamp with a smaller Wemo plug. Power and Auto-off tabs SHALL retain artwork position and card dimensions at desktop and phone widths. Switching tabs SHALL preserve drafts, send nothing and make inactive controls unavailable to keyboard interaction.

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

The dashboard SHALL offer Habitat at `#/habitat`, under the Companions destination, showing one connected four-room habitat with ten resident slots over its existing session copy. Eligible observed sessions SHALL retain their resident while present; newest sessions SHALL fill free slots with deterministic ID ties; known children SHALL NOT occupy slots and unknown parentage SHALL NOT be guessed. Overflow SHALL be visible and SHALL NOT evict occupants. Confirmed membership removal SHALL free slots, while disconnected or resyncing evidence SHALL freeze residents without inferred departures. Empty residents SHALL be labelled unassigned and resting. The page SHALL preserve manual swaps, explicit demo mode, per-resident aprons, forty positions, furniture routing and hopping, and the shared dashboard state precedence.

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
- **WHEN** Habitat is opened at desktop or phone width, with hidden document or unavailable canvas
- **THEN** status remains readable, controls remain accessible without overflow, motion follows visibility/pause, and rendering failure does not remove precise session information or crash the dashboard

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
- **THEN** padding follows one responsive rule, labels and controls fit without horizontal overflow, and footer links have usable targets

#### Scenario: Attention and unavailable evidence
- **WHEN** an agent needs input, a source is stale or unavailable, or a control is disabled
- **THEN** the existing written states, fixed attention colors, disabled protections and access to evidence remain distinguishable; shared styling does not make missing evidence appear current or turn an observation into success

#### Scenario: Quiet idle command feedback
- **WHEN** a Music card is opened before any command from that card
- **THEN** its idle face omits routine no-command boilerplate, while later command progress, errors and results remain visible through the existing feedback region

### Requirement: Quiet reusable companion cards
The dashboard SHALL render the same Reachy and MicroDuck cards on Home and their companion pages. Reachy SHALL be an optional Home card; the existing MicroDuck placement identifier and saved Home layouts SHALL remain valid. Each card SHALL keep its illustration mounted while tabs flip only the controls, retain its dimensions across tabs for unchanged content and remain readable at phone widths. Detailed source evidence and existing companion tools SHALL remain available on the owning pages.

#### Scenario: Place and navigate companion cards
- **WHEN** the operator adds Reachy or MicroDuck through Edit Home and opens their companion pages
- **THEN** the same card design and controls appear without enabling companions or changing existing placements

#### Scenario: Flip controls without moving artwork
- **WHEN** the user switches tabs with a pointer or keyboard on a desktop or phone
- **THEN** only the control face changes, artwork stays mounted, and card dimensions remain stable for unchanged content

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

### Requirement: Mac-local diagnostics viewer link on Connections
Connections SHALL show a Diagnostics card that links **Open Grafana · Local** only when the runtime's links (`GET /api/v2/links`, from the configuration file's `edge.placeLinks.grafana`) name a loopback `http` URL for it, exactly as a Local place is shown; without one the card SHALL say that no diagnostics viewer is configured, and while the links load it SHALL show no link. The card SHALL say that the viewer is on this computer's loopback only and is not reachable through the private remote entry, and that a missing record there is a gap, never proof that nothing happened. The dashboard SHALL render no log table, trace view or diagnostic query of its own (Hub #812 deferred, #813).

#### Scenario: A runtime that names the viewer
- **WHEN** a signed-in page opens Connections on a runtime whose links name `grafana` as `http://127.0.0.1:3000/`
- **THEN** the Diagnostics card links **Open Grafana · Local** to that address in a new tab, beside the Connection, Running build, Operator tools and Observed sources cards

#### Scenario: A run that names none
- **WHEN** a disposable run's links name no viewer
- **THEN** the card offers no link and says no diagnostics viewer is configured, so a preview never leads to an installed viewer

### Requirement: Quiet Automation workspace
Automation SHALL open on Routines and offer Routines, Rules and
Settings tabs using arrow, Home and End keys. Saved lists SHALL offer explicit
New/Edit actions, with editors hidden until requested. Switching tabs SHALL
preserve unsaved drafts without commands. Cancel SHALL reset only that editor
and return focus to its opener; a confirmed save SHALL close it and return
focus. Failed or uncertain writes SHALL retain the draft and existing guards.
Global status and errors SHALL remain outside the tabs. Recent attempts SHALL
use a disclosure retaining the existing admission, completion and effect evidence.
All existing routine, rule, interrupt, quiet-hour and budget fields and explicit
actions SHALL remain available under their existing authority and freshness
guards; presentation changes SHALL neither run nor replay a command.

#### Scenario: Browse and cancel a draft
- **WHEN** the operator opens New routine or New rule, changes its draft, switches tabs and returns
- **THEN** the draft remains intact, no command is sent, and Cancel closes and clears that editor with focus returned to its opener

#### Scenario: Explicit mutation and uncertain reply
- **WHEN** a routine or rule is saved, or its reply becomes uncertain
- **THEN** confirmed save closes the editor while uncertainty keeps the draft, global warning and existing write lock; creation remains disabled until explicit enable, and no automatic retry or run occurs

### Requirement: Explicit Music input measurement controls
The Audio page SHALL accept registered capture state versions 2.0, 2.1 and 2.2 and expose the current Music or configured microphone state and explicit measurement Start/Stop through the existing core owner and tracked command path. It SHALL bind commands to current authoritative revision and endpoint evidence, distinguish accepted from completed work, preserve failed and uncertain outcomes, and never resend automatically. Stop SHALL remain independently available during pending or uncertain Start when the core permits stopping. Existing playback controls SHALL retain their behavior.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or appears in another tab
- **THEN** it follows current capture state without starting, stopping or replaying capture

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts the explicitly selected Music or configured microphone measurement and later stops it
- **THEN** each deliberate action sends one revision-guarded tracked command, and the page shows acceptance separately from current capture state and its final outcome

#### Scenario: Stop while start is unresolved
- **WHEN** Start remains pending or uncertain and the current core state permits Stop
- **THEN** the independent Stop action remains available and uses the latest core revision without resending Start

#### Scenario: Authority or source unavailable
- **WHEN** the browser is read-only, the core state is stale or the capture endpoint is unavailable
- **THEN** unavailable actions explain their reason and no capture command is sent

### Requirement: Qualified expiring Music measurements
The Audio input meter SHALL display only actual derived measurements from the selected producer endpoint, input, microphone alias when applicable and active generation. It SHALL distinguish measured zero from unavailable input, preserve declared numeric meaning, refuse malformed/reordered/expired evidence and clear values on source, generation, state or connection loss. Freshness SHALL use a qualified core-time interval bounded by the local request and receipt, never an unqualified browser wall clock or a newly assigned receipt timestamp.

#### Scenario: Fresh signal and silence
- **WHEN** valid current-generation features arrive while the core reports active capture
- **THEN** the meter displays their actual level, including zero for measured silence, with numeric peak and full-scale crossing evidence

#### Scenario: Expiry and discontinuity
- **WHEN** features expire, arrive for an old generation, or capture becomes stale or disconnected
- **THEN** the meter becomes unavailable without retaining a live-looking value or changing its original evidence time

#### Scenario: Clock qualification fails
- **WHEN** the sync request is too delayed or the browser clock moves backward or jumps relative to its monotonic clock
- **THEN** measurement display stays unavailable until a new bounded sync qualifies time, and no capture command is sent by that recovery

### Requirement: Measurement-only presentation
The Audio card SHALL identify Music.app and any configured microphone by its public alias, and explain that it measures audio without controlling lights. A configured alias SHALL NOT imply device presence or permission. Selection alone SHALL start no capture. The card SHALL explain that microphone capture checks existing authorization and does not request permission. It SHALL offer no unsupported lighting effect or target control. The card SHALL use the existing shell and semantic controls, with visible keyboard focus and fitting content at desktop and 320/390px widths in light/dark appearance.

#### Scenario: Synthetic browser acceptance
- **WHEN** the card is exercised against a disposable runtime with synthetic producer features
- **THEN** keyboard and responsive layout checks pass, with no real source, microphone, device or installed service involved

#### Scenario: Bounded alias presentation
- **WHEN** the configured microphone alias has the maximum accepted length
- **THEN** selection, status and Start remain readable without page overflow at 320px before and during capture

#### Scenario: Explicit selection and refused microphone
- **WHEN** the operator selects a configured microphone, then explicitly starts it and the producer refuses the input
- **THEN** selection alone sends no capture command, the refusal leaves the meter unavailable, and the card directs the operator to check the device connection and existing Mac microphone permission without claiming a prompt was shown

### Requirement: Module-owned art presentation
The runtime dashboard SHALL expose the shipped art widget and Gallery through its existing authenticated module frontend and card catalog. It SHALL reuse the shell's connection and tracked-command controls, without polling, generated application code or a second persistent catalog. The art frontend SHALL also export a backdrop source that the shell mounts once on Home through the same module frontend scope while the art module runs, and that hands the shell the decoded image of the composition the Art widget would present: its largest still, read once through the existing authenticated content route, with its artwork, composition and rendition identity, size, palette and readiness, and no new route, `data:` or `blob:` URL or pixels outside page memory. With nothing to present or no source mounted, the backdrop SHALL report none without an image and without failing. Gallery browsing SHALL NOT change it. The presentation SHALL retain keyboard focus, touch controls, visible stale/unavailable feedback and captions at desktop and 320/390px widths in both browser appearances.

#### Scenario: Browse art with keyboard and a narrow screen
- **WHEN** the owner opens Gallery, selects a saved composition and operates its explicit controls using the keyboard at 390px
- **THEN** controls and captions remain visible without horizontal overflow, focus is visible and browsing sends no command

#### Scenario: The shell receives the presented artwork
- **WHEN** Home opens with a presented artwork
- **THEN** the backdrop export reports the artwork and composition the Art widget's selection rules choose, ready, decoded from one content request for that composition's largest still, and no request leaves the dashboard origin under the unchanged Content Security Policy

#### Scenario: Nothing to present
- **WHEN** no artwork is available to present, or the art module is not running
- **THEN** the backdrop export reports none with no image, Home renders and nothing throws

### Requirement: Presented art supplies presentation metadata
The art frontend SHALL expose as presentation metadata only the identity, validated palette and readiness/freshness of art actually decoded and presented. A pending catalog update SHALL NOT replace that presentation metadata, and the same rule SHALL hold for the backdrop image: a newer image that is loading, stale or failed SHALL leave the last ready image in place, and an obsolete load SHALL NOT replace a newer one. The presentation metadata SHALL combine the evidence of the visible widget and of the backdrop rendition the shell reports drawn, so one surface going idle does not erase the other's. Missing or stale evidence SHALL remain explicit. This metadata SHALL be transient presentation state, with the art module remaining the catalog owner and the core remaining the layout owner.

#### Scenario: A new catalog entry is pending
- **WHEN** the catalog announces new art while its rendition is loading
- **THEN** presentation consumers retain the visible artwork's palette until the new image is decoded and displayed

#### Scenario: A newer backdrop image is slow or fails
- **WHEN** the selection changes and the new backdrop image is still loading, or its bytes fail validation
- **THEN** the backdrop keeps the previous ready image and reports loading or unavailable, and a load for an older selection that completes later does not replace the newer image

#### Scenario: One surface goes idle
- **WHEN** the shell reports the backdrop rendition drawn and the Art widget leaves the viewport or unmounts
- **THEN** presentation consumers keep the backdrop's ready evidence; when the shell withdraws it too, the evidence becomes idle

### Requirement: Owner-controlled art theme
Settings SHALL offer Follow artwork, Lock current colors and Restore default as browser-local presentation controls. A successful save SHALL preserve the chosen mode and locked palette or locked default across reload and restart. Restore default SHALL remain effective until an explicit later choice. Storage failure or invalid saved input SHALL leave a usable prior/default theme with truthful save status and no automatic write retry. An applied art theme SHALL take only its hue and tint strength from the artwork's palette: every decorative role SHALL keep a fixed lightness step in light and dark appearance, so the page background, inset, panel and raised surfaces stay distinguishable for every accepted palette. The tint SHALL come from the first palette color that has a hue and does not read as black; a near-black color with a hue SHALL come after every lighter one, so it tints the interface only when no lighter color has a hue and may tint the second background wash when one lighter color has a hue; a palette with no hue SHALL give neutral surfaces.

#### Scenario: Lock and restore
- **WHEN** the owner locks displayed colors and another artwork appears, then the browser or runtime restarts
- **THEN** the locked colors remain, and Restore default returns to Quiet glass without changing layout or spending provider allowance

#### Scenario: Lock the default
- **WHEN** no valid art theme is applied and the owner locks current colors
- **THEN** the default remains locked across artwork arrivals and restart without inventing a palette

#### Scenario: Contrast and fixed meanings
- **WHEN** contrasting art palettes are applied in light and dark appearance across ordinary, warning, error, pending, disabled and focused controls
- **THEN** only allowed decorative roles change, text and focus remain readable, semantic/device colors retain their meanings and control geometry stays fixed

#### Scenario: Browser storage fails
- **WHEN** saving an explicit preference fails or another tab supplies invalid preference data
- **THEN** the page keeps a valid theme and clearly reports that the attempted preference was not saved or could not be read

#### Scenario: Dark or colorless artwork
- **WHEN** the visible artwork's palette starts with black or grey, or holds no colored entry, in light and dark appearance
- **THEN** cards, raised controls, inset areas and the rail remain distinguishable from the page background, and the tint comes from the first colored entry that does not read as black, or is neutral when the palette has no hue

### Requirement: The art widget follows authoritative browser selection
The widget SHALL acquire the selected existing browser composition through authenticated content, including when it is absent from the recent page. It SHALL finish decoding before replacing visible art or publishing its palette. Pending, stale, unavailable, deleted or superseded selections SHALL retain the established explicit feedback and obsolete-load protections. Gallery browsing SHALL remain a local choice and SHALL NOT silently rewrite authoritative selection or command a device.

#### Scenario: A selected older composition loads slowly
- **WHEN** authoritative state selects an older saved composition and its image is still loading
- **THEN** the widget retains the prior visible art and palette until the selected image is decoded, with no provider call

#### Scenario: Selection changes before decoding finishes
- **WHEN** a newer authoritative selection arrives before the old image finishes decoding
- **THEN** the old result cannot replace the newer choice or its presented palette

### Requirement: Art rhythm controls live in Automation
The dashboard SHALL expose the saved art policy, its explicit enable/disable action, waking hours and host zone, selected surfaces, six/seven/eight appearances, ambient behavior, generation and source-use controls within the existing Automation workspace. The page SHALL distinguish a draft from the saved revision, preserve edits on validation errors, reject stale writes and never retry a lost mutation. Read-only or disconnected clients SHALL not change policy. Controls SHALL remain keyboard-operable and readable at 320, 390 and desktop widths without moving active Home controls.

#### Scenario: An owner edits the rhythm on a phone
- **WHEN** a control user changes waking hours and count at 390px using the keyboard, saves and explicitly enables the policy
- **THEN** the saved values and next eligible opportunity read back, focus remains usable and no browser-side schedule or device-mode command starts

#### Scenario: Another tab changes the policy
- **WHEN** a draft's captured revision is no longer current
- **THEN** saving reports a conflict and preserves the draft for review instead of silently overwriting the newer policy

### Requirement: Forecast labels bind to actual visible art
The Art frontend SHALL display a deterministic forecast notice only after its opportunity's browser-selection operation succeeded and beside the exact artwork/composition it currently decoded and visibly presents. Reusing the same image ID SHALL NOT substitute for the new selection outcome. The label SHALL say forecast, preserve chance versus likely meaning, identify its time interval and make source freshness available. It SHALL remain separate from the decorative caption and palette. The Art frontend SHALL also export the notice as a compact chip for the shell, stated in the widget's words and bound by the same rules to the artwork the page presents: the visible widget's, or the backdrop rendition the shell reports drawn. Home's hero SHALL show that chip as a link that takes keyboard focus. Loading, an identity mismatch, hidden art, replacement, disabled policy, stale source, expired or unavailable notice evidence SHALL show no current factual label. A browser label SHALL expire at most 30 seconds after the admitted start and before source or forecast validity ends, without automatically restoring an older image. Manual Gallery selection and Home layout pin/dismiss behavior SHALL remain authoritative.

#### Scenario: A stale decode finishes after a new selection
- **WHEN** a forecast opportunity changes while an older rendition is still decoding
- **THEN** neither the obsolete art nor its forecast label replaces the new selection, and no factual label appears before its matching image is visible

#### Scenario: A forecast expires while its image remains
- **WHEN** the notice reaches its stale time while the decorative artwork is still visible
- **THEN** the factual label clears or explicitly reports unavailable evidence while the saved image remains decorative

#### Scenario: The forecast chip on Home
- **WHEN** a scheduled opportunity's browser selection succeeds and Home draws its artwork as the backdrop
- **THEN** the hero shows the chip with the notice's words only from the opportunity's start, bound to that artwork, and clears it when the notice expires while the drawn artwork remains

#### Scenario: The next opportunity reuses the same image
- **WHEN** an already visible image matches a new opportunity but its browser-selection operation is pending, refused or uncertain
- **THEN** the new factual notice remains hidden rather than borrowing evidence from the previous selection

### Requirement: The art schedule explains partial and suppressed outcomes
The Automation page SHALL separately show why an opportunity was suppressed and the current evidence for its generation, preparation, browser selection and each display command. Missing/stale operation state SHALL be labeled as such. No summary SHALL convert accepted requests into successful or physically observed art. Weather controls SHALL describe only their implemented source use; the deferred meeting feature SHALL add no placeholder switch or calendar reader.

#### Scenario: One display is unavailable
- **WHEN** an opportunity selects browser art and one display is unavailable while another is still awaiting completion
- **THEN** the page shows each result independently, names the unavailable surface and avoids a group success label

### Requirement: Calibration and response preview controls

The Audio page SHALL provide explicit quiet measurement, Cancel and Apply controls for the active microphone, with saved sensitivity, gate, band emphasis and smoothing settings plus editable drafts. It SHALL distinguish raw input from a numerical response preview and retained settings from current gate qualification. Uncertain commands SHALL not replay or disable otherwise permitted Stop. This contributes #722 AC1 through AC5 without device dispatch.

#### Scenario: Complete synthetic calibration journey
- **WHEN** the operator measures synthetic quiet input, reviews its candidate and explicitly applies response settings
- **THEN** the raw meter remains unchanged while the separately labelled preview uses the committed settings and shows the gate's status

#### Scenario: Retired qualification and passive reload
- **WHEN** capture retires or the page reloads with retained settings
- **THEN** an enabled unqualified gate is visibly inactive, no measurement/application runs automatically and explicit manual reapplication or a new calibration is available when current input permits it

#### Scenario: Conflict, uncertainty and Stop
- **WHEN** Apply conflicts or its result is uncertain
- **THEN** the draft remains reviewable, no automatic retry occurs and the independent Stop control remains usable when core state permits it

#### Scenario: Local interruption precedes the core update
- **WHEN** the browser observes source discontinuity, a gap, format change or expiry before the core retires the current application
- **THEN** an enabled response preview stays inactive for that application revision until a new Apply qualifies it, while valid raw input can resume independently

#### Scenario: A candidate does not erase a conflicting draft revision
- **WHEN** another editor saves settings before the operator chooses a measured candidate for the retained draft
- **THEN** the saved-settings conflict remains visible and Apply stays disabled until the operator reviews the conflict explicitly

### Requirement: Explicit Music lighting controls on Audio

The Audio page SHALL show a Music lighting card with one section per light in the core's synced `music-lighting-state` records, the Lines and the NL22 Light Panels each in their own. Each section SHALL show the session status, the saved preset in use and the last recorded ending, including its reason, restoration (with `uncertain`) and code when present. Each section SHALL explain what an ending will and won't put back: before Start from the light module's last read selection, unless the base was put back after that read, and otherwise by the general rule; during a session and after its ending from what the light module says that session's base was. It SHALL state that on the Light Panels a choice they report as an unsaved dynamic effect, such as one an app picks or plays, is not seen as a manual change and that an ending may put the base back over it, and that `*Dynamic*` there may be the frames an earlier Music session left (#1777). The card SHALL name no scene. It SHALL offer a saved reactive preset from the private Nanoleaf library and explicit Start and Stop through the shared tracked command path. Start SHALL carry the record's revision, the chosen preset and the current active Music.app capture endpoint and generation. Start SHALL be enabled only for an idle light, from fresh records, with an active Music.app capture, a fresh library holding the preset and control authority. Stop SHALL be available for starting, active, stopping and uncertain sessions, independent of an unresolved Start. Each section's Start and Stop SHALL target only its own light. The page SHALL never offer the microphone, switch a light's mode, send a command on load, reload, reconnect or record change, or restart a session after any ending. This contributes #722 AC2, AC3 and AC5, #1614 AC3 and #1272 AC3.

#### Scenario: Passive page lifecycle
- **WHEN** Audio opens, reloads, reconnects or the lighting, capture or library records change
- **THEN** the card follows the current records and sends no lighting command

#### Scenario: Explicit start and stop
- **WHEN** an authorized operator starts a light with a saved preset during active Music.app measurement and later stops it
- **THEN** each action sends one revision-guarded tracked command, and the card shows the core's saved request, the light module's work outcome and the light's reported session state separately, followed by the recorded ending and restoration

#### Scenario: Each light from its own section
- **WHEN** the Lines and the NL22 Light Panels are both configured, and the operator starts and stops the NL22 from its section
- **THEN** each command targets the NL22 only, its section shows its own session, which stays active past its once-per-second checks while the Panels report their streaming selection, and its own ending; the Lines' section and light stay as they were, and a capability refusal names the layout or the stream rather than saying only the Lines play; an ending where the light accepted the streaming entry but named no usable port says that no frame was sent, the light may stay in external control on its last presentation until it times out or a scene is chosen, and nothing was put back

#### Scenario: Endings never restart
- **WHEN** a session ends through Stop, an alert, a manual change, source loss, a device failure, a restart or a refusal, and Music capture later becomes active again
- **THEN** the card shows the ending in plain words with its restoration and code, and no Start is sent until the operator chooses Start again

#### Scenario: What an ending puts back
- **WHEN** the light's last read selection is a saved scene, a plain colour or a selection that cannot be selected again, a session plays over one of them, or it ends
- **THEN** the card says before Start, during the session and after the ending whether Stop, an alert or lost Music input puts the scene or colour back or leaves the last Music frame, that a scene or colour picked on the light wins except in the instant the session takes the light, that a brightness or power change there ends the session within about a second, after a Music frame may already have replaced the base, that on the Light Panels a choice they report as an unsaved dynamic effect is not seen and an ending may put the base back over it, and, for an ending with restoration `none` over an unnamed base, that nothing was put back and why

#### Scenario: Light Panels' dynamic selection
- **WHEN** the NL22's last read selection is `*Dynamic*`
- **THEN** the card describes it as an effect that is not a scene saved on the light or, on the Light Panels, streamed frames such as those an earlier Music session left, and says that an ending puts nothing back

#### Scenario: Light outside Free
- **WHEN** the light's saved mode is not Free and the operator starts it
- **THEN** the card has already explained that Start would be refused and the mode is never switched, and it shows the light's refusal as the recorded ending

#### Scenario: Unavailable inputs explain disabled controls
- **WHEN** the browser is read-only, command records are stale, the capture is inactive or a microphone, no preset is saved, or a Start or Stop is still unresolved
- **THEN** the affected control is disabled with its reason, a missing library links to the Music effect preview, and nothing is sent

#### Scenario: Stale reads and lost replies
- **WHEN** a lighting read fails or the connection drops, or a Start reply is lost
- **THEN** the card shows the last known state with controls disabled until a fresh read succeeds: a reconnect reads again on its own without sending anything, a restarted copy re-syncs on its own, a failed read waits for an explicit refresh, the lost Start stays locked and is not resent across reload, and Stop remains available once the record shows the session

#### Scenario: Keyboard and responsive presentation
- **WHEN** the card is exercised with the keyboard against a disposable runtime at desktop, 390px and 320px widths in light and dark appearance
- **THEN** controls are labelled and content fits without horizontal overflow

### Requirement: Read-only music visualizer on Audio, its full view and Home
The dashboard SHALL offer a music visualizer on the Audio page, in a full view at `#/audio/visualizer` and as a Home card that is not placed by default. Each surface SHALL draw only the derived capture features the Audio page already projects, and only while they are qualified: synchronized with a qualified clock, fresh, and from the active capture source and generation. It SHALL use the applied response values when present and otherwise the measured level and bass, mid and treble bands. It SHALL ease toward the newest feature window and SHALL NOT replay skipped windows. When measurement is off, idle, starting, stale, stopping, uncertain or unavailable, when no fresh window is present, or when the generation changes, it SHALL show a still resting scene and state the reason instead of frozen or invented motion. The full view SHALL cover the page chrome, SHALL offer full screen through the browser's Fullscreen API, and Exit or Escape SHALL return to Audio; the Home card SHALL show the chosen effect, any resting reason and a link to the full view. The visualizer SHALL send no command, start no capture, control no lights and add no message format. Surfaces on one page SHALL share one read-only capture scope.

#### Scenario: Live measurements drive the effect
- **WHEN** a disposable runtime receives synthetic feature windows for an active capture
- **THEN** the chosen effect on Audio, the full view and the Home card follows the level and band changes from the newest window

#### Scenario: The stream stops, goes stale or changes generation
- **WHEN** feature windows stop, the capture becomes stale, or the active generation changes
- **THEN** each surface shows a still resting scene with its reason, and a new generation starts without carrying motion from the old one

#### Scenario: Resting while measurement is not running
- **WHEN** the Home card is placed while measurement is idle or the producer is off
- **THEN** it rests and states why, and it can still be added, moved and removed with the existing Home editor

#### Scenario: The visualizer sends nothing
- **WHEN** a viewer opens, switches and expands the visualizer
- **THEN** no command, capture start or lighting request is sent, and all surfaces on the page share one capture scope that never runs more than one sync at a time

### Requirement: Browser-only visualizer effect choice
The visualizer SHALL offer Spectrum bars and Bass pulse. The chosen effect SHALL be a per-viewer preference kept in the browser's local storage, followed by the browser's other tabs, and SHALL NOT be a shared saved setting or a message. When storage is unavailable or refuses access, the choice SHALL still apply for the page.

#### Scenario: The choice survives a reload
- **WHEN** a viewer chooses Bass pulse and reloads the page
- **THEN** every visualizer surface in that browser shows Bass pulse, and no other browser's choice changes

#### Scenario: Storage is unavailable
- **WHEN** reading or writing the stored choice fails
- **THEN** the visualizer uses the default effect and still switches effects for the page

### Requirement: One rail that collapses and becomes a phone drawer

The shell SHALL present the destinations, the Settings utility, the feed indicator and the session's control mode in one rail that stays in view while a page scrolls; a window too short to hold the rail SHALL let it scroll with the page, with its parts kept together at the top of the page. In the full rail and the phone drawer Settings and the feed indicator SHALL share one row at the bottom of the rail, and in the icon rail the indicator SHALL sit under Settings. In the rail the indicator SHALL be an icon that keeps its accessible name and whose details name the feed's condition. The skip link SHALL be visible above the rail whenever it has focus. A destination chosen from a navigation link SHALL open at the top of its page; the shell SHALL NOT set the scroll position on back or forward navigation. From 1200px wide the rail SHALL start expanded; below that it SHALL start as an icon rail in which every destination keeps its accessible name and shows that name on hover or keyboard focus. A toggle SHALL switch between the two, and the choice SHALL be kept in the browser separately for the two window sizes. Unavailable or damaged browser storage SHALL leave the defaults and a toggle that still works for the open page. At phone width the rail SHALL be a drawer opened from a menu button. Collapsing, expanding, opening and closing SHALL send no command, sync or provider request.

#### Scenario: Default and remembered rail
- **WHEN** the operator opens the dashboard in a wide window and in a narrower one, toggles the rail in one of them and reloads
- **THEN** the wide window starts with the full rail and the narrower one with the icon rail, the toggled size keeps the operator's choice after the reload, and the other size keeps its own

#### Scenario: Navigate while scrolled
- **WHEN** the operator scrolls a long page and chooses a destination in the rail
- **THEN** the rail is still in view to choose from, and the chosen page opens at its top

#### Scenario: Icon rail
- **WHEN** the rail is collapsed and the operator points at or focuses a destination
- **THEN** the destination's name appears beside its icon, its accessible name is the destination name once, and Settings and the feed indicator remain reachable at the bottom of the rail

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu button at phone width
- **THEN** the destinations and Settings appear in a drawer over the page with focus inside it
- **AND** the page behind it cannot be reached with the keyboard or the pointer
- **AND** choosing a destination, pressing Escape or tapping outside closes it and returns focus to the menu button

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the rail choice
- **THEN** the defaults apply, the toggle still changes the rail for the open page, and nothing fails

#### Scenario: Ended session
- **WHEN** the browser session has ended while the rail would be collapsed
- **THEN** the full rail is shown so that the sign-in recovery action is readable
- **AND** at phone width the recovery action is shown beside the menu button without opening the drawer, and inside the drawer while it is open

### Requirement: Jump palette that opens any page

The shell SHALL offer a jump palette that lists, in this order, up to three pages visited most recently in the open page session, the hub's destinations with Timeline, Audio, Habitat, Settings and Connections, every hardware page a module the current catalog reports as running declares, including each device's own page, and then every other page such a module declares, so that pages outside the hardware inventory stay reachable. The current page SHALL NOT be listed as recent, each address SHALL be listed once outside the recent group, and a module that is not running or an address the catalog does not declare SHALL NOT be offered. Recent pages SHALL be held in memory only.

Command and K, or Control and K, SHALL open the palette from anywhere on the page and close it when it is open, except that on a Mac Control and K pressed in a text field SHALL keep its text-editing meaning. A slash SHALL open the palette only when it is pressed outside a text field and outside an open menu, list or dialog; a control that takes no typed text, such as a slider or a checkbox, SHALL NOT count as a text field. The rail SHALL hold a field that opens the palette, shown as an icon in the icon rail, and the phone bar SHALL hold a button that opens it. While a modal dialog is open or an element is shown full screen, the palette's keys SHALL do nothing.

While the palette is open the page and the rail behind it SHALL be inert, and the palette SHALL be drawn above everything the page draws, including the full-window visualizer. The palette SHALL read its keys wherever focus is, and a press on a part of it that is not a row SHALL leave focus in its field. Typing SHALL narrow the list to the entries whose name or hint contains every typed word, with a name that starts with the query first. The chosen row SHALL be marked by a boundary with at least 3:1 contrast against the palette and against the row. The arrow keys SHALL move the choice, bring it into view and wrap at the ends; a list scrolled by touch or wheel SHALL otherwise stay where it was put, and Enter or a click SHALL open the chosen page at its top with focus on the page. An Enter still held from opening the palette SHALL NOT choose a row. Escape, the opening key again or a click outside SHALL close the palette and return focus to the element that had it; when it was opened from the phone drawer, focus SHALL return to the menu button. A page change made with the browser's back or forward while the palette is open SHALL close it. The palette SHALL fit a 320px window without horizontal overflow.

The palette SHALL only navigate. Opening it, typing, moving the choice and closing it SHALL send no command, sync, upload or provider request.

#### Scenario: Open from the keyboard
- **WHEN** the operator presses Command and K, Control and K outside a text field, or a slash outside a text field
- **THEN** the palette opens with focus in its field, listing recent pages, hub destinations and device pages
- **AND** the page and the rail behind it cannot be reached with the keyboard or the pointer

#### Scenario: A slash in a text field
- **WHEN** the operator types a slash in the Conversation composer or another text field
- **THEN** the slash is entered as text and the palette stays closed

#### Scenario: Narrow and open
- **WHEN** the operator types part of a page's name, moves the choice with the arrow keys and presses Enter
- **THEN** the list holds only matching pages with the best name match first
- **AND** the chosen page opens at its top with focus on the page, although the page left was scrolled

#### Scenario: Close and return
- **WHEN** the operator opens the palette from the Conversation composer with a draft in it and presses Escape
- **THEN** the palette closes, focus is in the composer again and the draft is unchanged

#### Scenario: Catalog change
- **WHEN** the catalog the page holds reports a module as stopped
- **THEN** that module's pages are not offered and the other pages still are

#### Scenario: Phone
- **WHEN** the operator taps the search button in the phone bar, or the field in the open drawer, at phone width
- **THEN** the palette opens within the window with no horizontal overflow
- **AND** closing it returns focus to the search button, or to the menu button when it was opened from the drawer

#### Scenario: Modal dialog open
- **WHEN** Conversation Details is open as a modal dialog and the operator presses Command and K or a slash
- **THEN** the palette stays closed and the dialog stays open

#### Scenario: Scroll the list
- **WHEN** the operator scrolls the list by touch or wheel and the shell renders again
- **THEN** the list stays where it was put
- **AND** the next arrow key brings the choice into view

#### Scenario: Focus leaves the field
- **WHEN** the operator presses on a group heading or the footer of the palette, or focus is outside the field for another reason
- **THEN** the arrow keys, Enter and Escape still act on the palette, typed text goes to the field and nothing behind the palette reacts

#### Scenario: Over the full-window visualizer
- **WHEN** the operator opens the palette on the full-window visualizer
- **THEN** the palette is drawn above the visualizer, and Escape closes the palette and leaves the visualizer open
- **AND** while an element is shown full screen the palette's keys do nothing

#### Scenario: Back while open
- **WHEN** the palette is open and the operator goes back in the browser's history
- **THEN** the preceding page is shown, the palette is closed and the page can be used

#### Scenario: Passive palette
- **WHEN** the operator opens the palette, moves the choice, types and closes it
- **THEN** no command, sync, upload or provider request is sent

### Requirement: Devices menu that opens every device page

The Devices row SHALL open a menu that lists the hardware the Devices directory lists for a module the current catalog reports as running, grouped under Displays, Lighting and Appliances with each address once, and an "All devices" entry that opens the directory. Pixoo and Tidbyt SHALL each be one entry. Each lighting brand SHALL be a disclosure, collapsed when the menu opens, that expands to an entry for each of its lights and an entry for the brand's overview; the brand that holds the open page SHALL start expanded. A module with several devices SHALL be a heading over them, and a module with one destination SHALL be that destination under the module's name. A module that is not running SHALL be named with its state and SHALL offer no page, and a running module whose observations are stale SHALL be marked stale. The menu SHALL mark the pinned pages and the page that is open.

The menu SHALL have a head with its own close button, SHALL open beside the rail level with the Devices row and inside the window, in the full rail and in the icon rail, and its lists SHALL scroll when the window is shorter than its content while "All devices" stays in view at its foot, with every brand expanded. It SHALL open with focus on the open page's entry, or on its first entry when the open page is not in it. The arrow keys SHALL move through the entries that are shown, skipping a collapsed brand's lights, and wrap at the ends; Enter, Space and the right arrow SHALL expand a brand, and the left arrow SHALL collapse the brand from its disclosure or one of its lights; Home and End SHALL move to the first and the last entry, and the focused entry SHALL have a visible indicator. With focus on no entry, the down arrow SHALL start at the first entry and the up arrow at the last. Escape SHALL close the menu with focus on the Devices row, and so SHALL a press on the row. A press outside the menu, a chosen page, the jump palette's opening key and focus moving out of the menu SHALL each close it, and a press or a focus move inside a framed module page SHALL count as outside. A page change or a change of layout that removes the menu while it holds focus SHALL move focus to the Devices row, or at phone width to the menu button. A chosen page SHALL open at its top with focus on the page. In the icon rail the Devices row SHALL keep its accessible name while the menu is open.

At phone width the menu SHALL cover the drawer as one scrolling column with its own close button, which SHALL leave the drawer open. Escape SHALL close the menu before the drawer. A chosen page SHALL close the menu and the drawer and return focus to the menu button.

The menu SHALL only navigate. Opening it, expanding and collapsing its brands, moving through it and closing it SHALL send no command, sync, upload or provider request.

#### Scenario: Open and move with the keyboard
- **WHEN** the operator presses Enter on the Devices row and then the arrow keys, Home and End
- **THEN** the menu opens beside the rail with focus on an entry, and focus moves through the shown entries, skipping collapsed lights, and wraps at the ends
- **AND** Escape closes the menu with focus on the Devices row

#### Scenario: Choose a page
- **WHEN** the operator chooses a page in the menu
- **THEN** the menu closes and the page opens at its top with focus on the page and Devices selected

#### Scenario: Close without choosing
- **WHEN** the operator presses outside the open menu, presses inside a framed module page, presses the Devices row again or moves focus out of the menu with Tab
- **THEN** the menu closes and no page is opened

#### Scenario: The page changes under the menu
- **WHEN** the operator uses the browser's back button while the menu is open with focus in it
- **THEN** the menu closes and focus is on the Devices row

#### Scenario: A module is not running
- **WHEN** the catalog the page holds reports a module as stopped, failed or refused
- **THEN** the menu names the module with that state and offers none of its pages, and the other modules' pages are still offered

#### Scenario: Phone drawer
- **WHEN** the operator opens the menu from the drawer at phone width and uses the menu's close button
- **THEN** the menu had covered the drawer as one scrolling column, and closing it leaves the drawer open with focus on the Devices row

#### Scenario: Expand a lighting brand
- **WHEN** the operator expands Nanoleaf and LIFX in the menu and chooses a light
- **THEN** Nanoleaf lists its Lines and Panels and LIFX its distinct fixtures, each with the brand's overview, the light's existing device page opens, and the menu opens again with that light's brand expanded and the other brand collapsed

### Requirement: Pinned pages in the rail

A device page, a lighting-brand page, the Audio page and a declared module page SHALL offer a toggle in the page header that pins the page to the rail and unpins it. The Conversation page and the hub's own destinations SHALL NOT offer one. The rail SHALL list the pinned pages under the destinations in the order they were pinned, each as a link named for the page and, where the page is one of several of a module, for the module too. A pinned row SHALL offer an unpin button when the row is pointed at or the button has keyboard focus. The page that is open, when it can be pinned and is not, SHALL be a temporary row with a pin button that is always shown. A row for a page whose module is not running SHALL show that module's state in its text and in its name. After a row's own button is used, focus SHALL stay in the rail: on that row's button when the row is still there, and otherwise on the row before it or on the Devices row.

Pins SHALL be kept in the browser only. They SHALL survive a reload and SHALL follow a change made in another tab of the same browser. Unavailable or damaged browser storage SHALL leave pins working for the open page. A pin whose page the current catalog and device records do not declare SHALL NOT be shown and SHALL stay saved.

The pinned list SHALL scroll inside the rail when it is longer than the room above the rail's bottom group, which SHALL stay in view. The rail SHALL always have room for the list's heading and one row, and a window too short for that SHALL let the rail scroll with the page. With nothing to list, the rail SHALL show the list's heading alone, with no line of explanation under it, and SHALL keep the room for one row. In the icon rail a pinned page SHALL be shown as a short mark whose link keeps the page's name. Pinning, unpinning and opening a pinned page SHALL send no command, sync, upload or provider request.

#### Scenario: Pin from a page header
- **WHEN** the operator uses the toggle in a device page's header and then opens another page
- **THEN** the rail lists the pinned page, and its row opens the page at its top

#### Scenario: Unpin and reload
- **WHEN** the operator pins two pages, unpins one from its row and reloads
- **THEN** the remaining pin is listed after the reload and the unpinned page is not

#### Scenario: The open page is not pinned
- **WHEN** the operator opens a page that can be pinned and is not
- **THEN** the rail shows it as a temporary row whose button pins it, and leaving the page removes the row

#### Scenario: A page is no longer declared
- **WHEN** the catalog the page holds no longer declares a pinned page
- **THEN** its row is not shown, the other pins are, and the pin is listed again once the page is declared

#### Scenario: A pinned page's module is not running
- **WHEN** the catalog the page holds reports the module of a pinned page as stopped, failed or refused
- **THEN** the row stays and shows that state, and the page it opens says that it is unavailable

#### Scenario: Storage refused
- **WHEN** the browser refuses to read or save the pins
- **THEN** the page starts with no pins, pinning and unpinning still work for the open page, and nothing fails

#### Scenario: Long list
- **WHEN** more pages are pinned than fit above the rail's bottom group
- **THEN** the list scrolls inside the rail and Settings and the feed indicator stay in view

#### Scenario: Nothing pinned
- **WHEN** nothing is pinned and the open page cannot be pinned
- **THEN** the rail shows the Pinned heading with nothing under it
- **AND** opening a page that shows a temporary row does not change whether the rail stays in view

#### Scenario: Conversation page
- **WHEN** the operator opens the Conversation page
- **THEN** its header has no pin toggle and the rail shows no temporary row for it

### Requirement: Conversations in the rail

While the current catalog declares the Conversation page of a running companions module, the rail SHALL list the chat profiles in its bottom group, above Settings, on every page: B.U.N.N.Y., Reachy and MicroDuck, with Reachy and MicroDuck labelled Demo. Each SHALL be a link that opens the Conversation page showing that profile with that profile's own history. The open conversation's row SHALL be marked as the current page, and on the Conversation page the Companions row SHALL be marked without a box, so that the rail boxes one row. Without that declaration the rail SHALL show no conversation group.

The group SHALL be the companions frontend's own component, which the shell mounts in its own module scope through the module's public frontend entry; the shell SHALL read no other part of that module's conversation. Choosing a profile SHALL send no command and SHALL register no speech endpoint. Choosing one while the Conversation page is open SHALL keep that page mounted, with each profile's draft.

A row SHALL carry a marker, and the words "Needs your answer" in its name, while that profile's task waits on a clarification or an approval that has no answer. A task that waits on the coding worker SHALL carry none. The marker SHALL be absent whenever the group's copy of the assistant state is missing, failed, removed, restarted or unavailable, and until the kind of the pending question has been read. The group SHALL learn the kind from one bounded read of that profile's recent history for a pending question, or from the open Conversation page when the page has read it. A read that fails SHALL NOT be repeated on a timer. It SHALL be made again when the state copy next changes or is live again, or when the open Conversation page stops showing that profile. At phone width the menu button SHALL carry the marker when a conversation other than the open one needs the owner.

In the icon rail a conversation SHALL be a tile whose name, Demo label and need appear beside it on hover or keyboard focus. In the phone drawer a row SHALL be a full touch target, and choosing one SHALL close the drawer and return focus to the menu button.

#### Scenario: Open a conversation from another page
- **WHEN** the operator is on Home, Rooms or a device page and chooses a profile in the rail
- **THEN** the Conversation page opens showing that profile with its own history, and its row is marked as the current page

#### Scenario: Change profile on the Conversation page
- **WHEN** the Conversation page is open with a draft and the operator chooses another profile in the rail and then the first one again
- **THEN** each profile shows its own history and draft, the first draft is still there, and no command, sync or speech endpoint registration is sent

#### Scenario: A conversation needs the owner
- **WHEN** a profile's task waits on a clarification or an approval
- **THEN** its row carries the marker on every page, and at phone width the menu button carries it unless that conversation is the open one

#### Scenario: Delegated work
- **WHEN** a profile's task waits on the coding worker
- **THEN** its row carries no marker

#### Scenario: State is not live or the kind is not known
- **WHEN** the assistant state copy is missing, failed, removed, restarted or unavailable, or the read of the pending question fails
- **THEN** no marker is shown, the rows stay links, and the failed read is not repeated on a timer

#### Scenario: A failed read is made again
- **WHEN** the read of a pending question has failed and the state copy changes or is live again, or the open Conversation page moves to another profile
- **THEN** the group reads that question once more, and marks the row when the question needs the owner

#### Scenario: Companions is not available
- **WHEN** the catalog reports the companions module as not running, or does not declare its Conversation page
- **THEN** the rail shows no conversation group and the menu button no marker

### Requirement: Home on a clear glass layer

Home SHALL draw the presented artwork unblurred behind the page, continuing behind the rail, which SHALL be frosted, and every Home card on flat, transparent glass with a thin bevel, a soft shadow and a rim, where neighboring panels lean together. With no image to draw (nothing presented, the first image still loading or unavailable, or the art module stopped), the backdrop SHALL be the Quiet glass wash and the glass SHALL still be drawn. Each card's glass SHALL follow its box through scrolling, resizing, Edit Home and paging. The layer SHALL draw only while something changes or settles, SHALL draw no frame at rest, SHALL cap the pixel ratio at 2 and SHALL release its context when Home is left. Text on the glass and the page heading SHALL keep at least 4.5:1 contrast against what is drawn behind it in light and dark appearance. Without WebGL 2, or after the context is lost, Home SHALL show its Quiet glass panels with every control working. The layer SHALL take no pointer input and SHALL send no command, sync or request; its colors SHALL come from skin tokens and it SHALL use no `data:` or `blob:` image.

#### Scenario: Artwork backdrop
- **WHEN** Home opens while an artwork is presented
- **THEN** the artwork fills the window behind the cards and the rail, each card is drawn on glass over it, and the card surfaces are see-through

#### Scenario: Glass follows the boxes
- **WHEN** the operator scrolls, resizes the window, moves or reshapes a card in Edit Home, or pages a list that changes a card's height
- **THEN** each card's glass is redrawn at the card's new box

#### Scenario: At rest
- **WHEN** nothing on Home changes after the first appearance has settled
- **THEN** the layer draws no frame

#### Scenario: No WebGL 2 or a lost context
- **WHEN** the browser has no WebGL 2, or the layer's context is lost
- **THEN** every card shows its Quiet glass panel over the Quiet glass wash, every control works, and a restored context draws the glass again

#### Scenario: Readable text over any artwork
- **WHEN** a dark or a bright artwork is presented in light or dark appearance
- **THEN** the text on each panel and the page heading measures at least 4.5:1 against the pixels behind it

### Requirement: Hub mode hero on Home

Home SHALL show a fixed hero above its cards (owner decision 5 of epic #1927): a small "Hub mode" label, the synced saved mode as a large word, a Work, Free and Quiet switch and short status chips. The switch SHALL send the same guarded hub mode command, with the same states, as the Hub mode card it replaces: a new request ID and the current selection revision, disabled while a request is pending, stale, not observed or read-only, with refused and uncertain results, Check Inbox and the mode exceptions with their native-difference links shown as before and nothing sent again. The switch SHALL be one keyboard stop where arrow keys, Home and End move between segments without selecting and Enter or Space selects. On the glass layer the selected segment's thumb SHALL be drawn as glass that stretches while it travels, on a time base independent of the display's refresh rate, and SHALL draw no frame once it has settled; without the layer the selected segment SHALL show a plain fill and the switch SHALL work. The chips SHALL show how many lights are on and which plugs are on from the observed device records the shell holds, counting a stale copy, an unavailable device or an unobserved power state as unknown and never as off; the art's forecast notice; Open Gallery; and the art's placement chips. Every chip SHALL take keyboard focus with a visible focus indicator. The hero SHALL be disabled while Home is edited, SHALL send nothing on its own and SHALL take its colors from skin tokens.

#### Scenario: Change the mode from the hero
- **WHEN** the owner moves through the switch with the arrow keys and selects Work with Enter
- **THEN** moving sends nothing, selecting sends one hub mode command with the current revision, the word and the selected segment show Work once the record changes, and the glass thumb stretches on its way and then draws no further frame

#### Scenario: A refused or uncertain change
- **WHEN** the hub mode command is refused, or its reply is lost
- **THEN** the hero shows Not applied or Result unknown with the reason, the saved word is unchanged and the command is not sent again

#### Scenario: The chips follow the observed devices
- **WHEN** a light is switched off, and later the dashboard's copies become stale
- **THEN** the lights chip counts one fewer light on, and while stale the light and plug chips say unknown and the switch is disabled

#### Scenario: Keyboard focus on the chips
- **WHEN** the owner tabs past the switch
- **THEN** each enabled chip takes focus in turn with a visible focus indicator

#### Scenario: Without WebGL 2
- **WHEN** the browser has no WebGL 2
- **THEN** the selected segment has its own plain fill and choosing another mode sends one command and shows it

### Requirement: Companions destination with an overview

The Companions destination SHALL open an overview at `#/companions` that links Habitat and, while the current catalog reports a running companions module, each companion profile page, Preferences and Companion knowledge that the module declares. The Conversation page SHALL NOT be listed there; its conversations stay in the rail. Without a running companions module the overview SHALL offer Habitat alone and say why. Habitat and the companions module's pages SHALL show Companions as their parent above the page. The overview SHALL only navigate and SHALL send no command, sync, upload or provider request.

#### Scenario: Open companion features
- **WHEN** the operator chooses Companions in the rail and then one of its links
- **THEN** the overview lists Habitat, the companion profiles, Preferences and Companion knowledge, and the chosen page opens at its existing address with Companions selected

#### Scenario: An old Habitat bookmark
- **WHEN** the operator opens `#/habitat`
- **THEN** Habitat opens with Companions selected in the rail and named as its parent

#### Scenario: Companions is not running
- **WHEN** the catalog reports the companions module as stopped, or the catalog cannot be read
- **THEN** the overview offers Habitat and says why the companion features are unavailable

### Requirement: Display pages as one device with views

Tidbyt SHALL open its existing Status and Content card as one view with no page tabs. Pixoo SHALL open its device page as Display, for current playback and screen controls, with tabs for Display, Media and Agent status: Media SHALL hold Library and Playlists, and Agent status SHALL be the Monitor. Display SHALL link Advanced playback, which is the Player page, and Device settings, which is the Settings page; a linked page that is open SHALL be shown as a tab of its own. The Pixoo pages SHALL be titled with the display's name. Every existing Pixoo and Tidbyt address SHALL remain valid and open its view. A page a display declares that no view names SHALL stay reachable as a tab of its own. The views SHALL change navigation only: each module keeps its data, its reads and its guarded commands.

#### Scenario: Reach Monitor features and Device settings
- **WHEN** the operator opens Pixoo from the Devices menu and chooses Device settings, then Agent status, then Media and Playlists
- **THEN** the Settings, Monitor and Playlists pages open at their existing addresses with their view marked, and nothing is sent until the operator uses a control

#### Scenario: Old display bookmarks
- **WHEN** the operator opens `#/module/pixoo/player`, `#/module/pixoo/monitor` or `#/module/tidbyt/display`
- **THEN** the page opens with Advanced playback, Agent status or the Tidbyt card shown

### Requirement: Readable device names in navigation

The Devices menu, the directory, the jump palette, the pins and a device page's heading SHALL name a device by the label its device record publishes. Without one, a Nanoleaf controller SHALL be named Lines or Panels from the kind its module observes, and any other device SHALL be named by its stable ID read as words. Two devices of one module that would share a name SHALL be told apart by their IDs. A module with one device, other than a light, SHALL be named by the module in the menu, the palette and the pins. Names SHALL change presentation only: routes, pins and commands SHALL keep the stable IDs.

#### Scenario: Lights without published names
- **WHEN** the Nanoleaf records publish no labels and the LIFX records publish none
- **THEN** the Nanoleaf lights are named Lines and Panels and each LIFX fixture by its ID read as words, and each opens its existing device page

### Requirement: Devices, Companions and display pages on the shared glass layer

The Devices directory, the Companions overview and the Pixoo and Tidbyt pages SHALL draw on the shared glass layer over the Quiet glass wash, with no artwork backdrop and no fusing of neighboring panels. Each directory card, each overview card, a display's device card and a display's module page SHALL be one glass panel, and text that sits on the wash outside a panel SHALL carry a veil. Text over the layer SHALL keep at least 4.5:1 contrast in light and dark appearance. The layer SHALL draw nothing at rest. Without WebGL 2 or after a lost context the pages SHALL show their Quiet glass panels with every control working. The Devices popout SHALL keep its own fill over the layer. Leaving these pages SHALL release the layer.

#### Scenario: Glass at rest
- **WHEN** the operator opens the Devices directory, the Companions overview or a Pixoo or Tidbyt page in light or dark appearance
- **THEN** each card has a glass panel that follows its box, the page's text keeps 4.5:1, and the layer draws no frame while nothing changes

#### Scenario: No WebGL 2 or a lost context
- **WHEN** the browser has no WebGL 2, or the layer's context is lost
- **THEN** the pages show their Quiet glass panels, and the Devices menu, the directory's cards, the display tabs and the Companions links still work and send no command

### Requirement: Plug press panel on Home

A Wemo plug in the Small square Home shape SHALL be a press panel: its name, a state line with its observed power or the limitation that blocks it (stale, unavailable, held, power unknown or read-only), and Open to its existing device page. When the plug's latest power request succeeded after its last report, it SHALL show beside the observed power until the plug reports it; a latest request that did not succeed SHALL leave the observation in charge. Pressing the panel by mouse, touch, Enter or Space SHALL send the existing guarded power command for the opposite of the newest power so defined, the same command the full card sends; the panel SHALL be disabled while that power is unknown or a guard blocks a change. Its pressed state SHALL follow that newest power and its light the plug's observed power, and a command result that needs attention SHALL show on the panel. The panel's top right SHALL stay clear.

#### Scenario: Press the plug
- **WHEN** the operator presses the panel by pointer, touch or keyboard
- **THEN** one power command identical to the full card's is sent, and the panel shows on or off when the plug reports it

#### Scenario: A lost reply
- **WHEN** a plug's power reply is lost
- **THEN** the panel shows the uncertain result, cannot be pressed, and nothing is sent again

### Requirement: Lights light Home's glass

On Home's glass layer a light or a plug that current records observe on SHALL light the room from its lamp (a dial's ring center, a plug's icon, or the artwork of a light card in another shape): its panel SHALL take up to half its color from the light, brightest near the lamp; the backdrop SHALL take its light thinning with the square of the distance, halved where another panel is in the way; and the bevels of panels facing the lamp SHALL catch it. A LIFX light's color SHALL be its observed `lifx-light` color; a light whose module reports no color, and a plug, SHALL glow in the skin's warm white. The level SHALL follow observed brightness (a plug 0.8), and a requested, stale or unknown state SHALL draw no light. A panel held down by the pointer SHALL brighten, widen its bevel and spill white light at half strength. Light and press SHALL ease at 16% and 24% of the remaining gap per frame at 60 frames a second on a time base, and the layer SHALL draw no frame once they settle. With every light off no light SHALL be drawn.

#### Scenario: Observed color and warm white
- **WHEN** a LIFX light observed red, a Nanoleaf light and a plug are on
- **THEN** the LIFX panel glows red from its ring's center and the backdrop above it takes red, while the Nanoleaf light and the plug glow warm white

#### Scenario: Every light off
- **WHEN** every light and plug on Home is observed off
- **THEN** the layer draws exactly what it draws for panels with no lamp, and draws no frame at rest

### Requirement: Unfold a light in place on Home

On Home's unit grid, a light, room or group ring dial in the Small square shape SHALL have an arrow at its top left that unfolds the card in place to Large square, placed with the existing first-fit packing, showing the dial, its name and state, a link to the card's own page, its options and the controls of a two-row light card: power and brightness with the saved mode, color, scenes and the timer. The cards whose boxes change SHALL ease from where they were to where they are over 720 ms with the reference's small overshoot, and with reduced motion SHALL move at once. One card SHALL be open at a time: opening another closes the first. The arrow or Escape SHALL close the open card. Opening SHALL move focus into the opened controls, and closing by the arrow or by Escape from inside the card SHALL return focus to the arrow. Opening and closing SHALL send no command, request or save and SHALL NOT change the saved Home layout or any card's saved shape; the open card SHALL live only in the page's memory, so a reload shows none open. Entering Edit Home, a narrow screen or the Phone arrangement SHALL close the open card; there the full light cards are shown as before. The opened card's content SHALL fit its box with nothing scrolled, and Home SHALL NOT scroll sideways at any width with a card open. Without WebGL 2 the arrow and the opened controls SHALL work on the Quiet glass panels.

#### Scenario: Open and close by pointer, touch and keyboard
- **WHEN** the operator opens a light by clicking, tapping or pressing Enter on its arrow, then closes it with the arrow or Escape
- **THEN** the card becomes Large square with its controls and focus on its first control tab, then returns to Small square with focus on its arrow, and no command is sent

#### Scenario: One at a time
- **WHEN** a light is open and the operator opens another
- **THEN** the second opens and the first closes

#### Scenario: Never saved
- **WHEN** the operator reloads Home with a light open, or enters Edit Home
- **THEN** no light is open, every card shows its saved shape and the saved Home layout is unchanged

#### Scenario: Every width
- **WHEN** a light is open at 1440 or 1024 px, and the window then narrows to 390 or 320 px
- **THEN** the page has no sideways scroll; at the narrow widths the cards stack with their full content and the light is no longer open

### Requirement: Liquid glass while panels move

On Home's glass layer a panel whose box moves or changes size while a panel eases (such as when a light unfolds and its neighbors make room) SHALL turn liquid by how fast it changes, reaching full at 9 CSS pixels per frame at 60 frames a second: its corners SHALL round toward a capsule by up to 60%, its edge SHALL be displaced by noise up to 17 pixels either way, and its join to neighbors SHALL widen to 2.3 times. The state SHALL rise half the remaining gap per frame and settle by `exp(-3.4 s)`, both on a time base, and the layer SHALL draw no frame once every panel has settled. While a panel element is animating, the layer SHALL follow its box every frame. Scrolling, something added above the page, a window resize, a box that changes at once (a card's content growing, a move in Edit Home) and reduced motion SHALL NOT turn a panel liquid; a window resize and a box that changes at once SHALL each still draw one frame.

#### Scenario: A light unfolds
- **WHEN** a light opens and its neighbors move to make room
- **THEN** the opened panel and the panels that move turn liquid while they move, settle in about a second, and then the layer draws nothing

#### Scenario: Window resize and reduced motion
- **WHEN** the window is resized with a light open, or a light opens with reduced motion
- **THEN** no panel turns liquid and the glass follows each card's new box
