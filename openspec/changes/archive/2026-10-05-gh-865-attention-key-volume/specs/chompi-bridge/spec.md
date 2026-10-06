## RENAMED Requirements

- FROM: `### Requirement: OS adapter contract version 3`
- TO: `### Requirement: OS adapter contract version 4`

## MODIFIED Requirements

### Requirement: OS adapter contract version 4
OS adapter interface version 4 SHALL report every observation as known or unknown and SHALL compare titles inside the adapter without returning title or conversation text. Codex selection SHALL take the thread ID and the slot's Hub title: the adapter SHALL compare the name Codex keeps for that thread ID, read from `session_index.jsonl` in the Codex home (only `id`, `thread_name` and `updated_at`; a thread's last line is its current name), and SHALL use the Hub title only when Codex has never named the thread. It SHALL answer unknown, before any UI query, when the index cannot be read, when the thread's last entry is unusable or older than an earlier entry, when neither name exists, and when any other thread's current name equals the name to compare or any other thread whose current name is unusable has carried it. The Windows adapter SHALL type keys with `SendInput` through koffi FFI, identify the foreground window by package family (the process's package identity, or, when the process has none, the installed package folder its image runs from directly under `<Program Files>\WindowsApps`, as Codex Desktop's window process does; a real package identity always wins), open links through the shell, and use a long-lived PowerShell UI Automation helper for composer focus, the Codex selected row, approval cards and card answers. It SHALL report composer focus as `false` and the Codex selected row as unknown when that client is not the foreground app, SHALL report approval visibility from element class tokens in the client's own foreground window, offscreen elements included and never reading a name or value: Claude as `true` while any element carries the `epitaxy-approval-card` token and `false` when none does, and Codex as `false` only while exactly one `Edit` composer carries the `ProseMirror` token, because its approval card replaces the composer, and unknown when there is none or several. It SHALL report approval visibility as unknown when that client is not the foreground app, when the helper fails or replies malformed, and when the foreground changes during the check. It SHALL read Codex archive filenames and Claude Desktop records by name and key only, SHALL never log, persist or return Codex thread names, SHALL send mouse-wheel input for `scrollClient` only while that client is the foreground app with the pointer inside its window (answering known `false` otherwise, without moving the pointer, clicking or typing), and SHALL release every key it holds on `releaseAll` and `close`. For the system volume (`sendVolumeKey`), the Windows adapter SHALL tap `VK_VOLUME_UP` (0xAF), `VK_VOLUME_DOWN` (0xAE) or `VK_VOLUME_MUTE` (0xAD) 1-10 times in one `SendInput` batch of down and up pairs, as extended keys, without observing any window, and SHALL refuse the request without sending while it holds any key, while the user holds a modifier, or when the key or count is invalid. Volume keys SHALL NOT be shortcut key names, so no profile can name them. For card answers the adapter SHALL report the open card's actionable buttons (`cardButtons`), move keyboard focus to one of them (`focusCardButton`) and press the focused one (`invokeCardButton`), in the client's own foreground window and process like the other window checks, returning only counts, indexes and booleans and never reading a name or value. A card's actionable buttons SHALL be its `Button` elements (descendants for Claude, direct children for Codex) that are enabled, support Invoke and do not support ExpandCollapse, in tree order; more than 64 `Button` elements in that scope, counted before this filter, SHALL be unknown; text fields are never among them. A card's wheel stops SHALL be its actionable buttons, except that a Claude card with at least one actionable button carrying the class token `text-left` (a question card's answer rows and its "Other" row) SHALL stop only on those buttons, in tree order, as Up and Down move inside its option list; button counts and indexes SHALL refer to the stops. Each card SHALL carry an identity, its container's UI Automation runtime ID, which is an ID and not window text and which a new card is assumed, not yet shown, never to share. Claude's card SHALL be the one element carrying `epitaxy-approval-card`: none is no card and several are unknown. Codex's card SHALL exist only while its window has no `ProseMirror` composer, exactly one sidebar row `Button` whose class starts with `group relative cursor-interaction` carries `bg-primary-ghost-hover`, and exactly one `Group` that is not offscreen directly holds at least one `Text` element and at least two actionable buttons, which is the card, whether or not any of its buttons has keyboard focus, because Codex does not reliably give its card focus; its stops SHALL be that group's actionable direct-child buttons. Keyboard focus elsewhere, such as on the sidebar row or the card's menu button, SHALL NOT affect the card; then no stop is focused. The search SHALL read one cached list of the window's `Group` elements (class names and offscreen state only), unknown above 512, and one cached list of each on-screen candidate's direct `Text` and `Button` children, never a name or value. One composer is no card; no composer without exactly one selected row and exactly one such group, with zero or several groups, or several composers, is unknown. Focusing and pressing SHALL name the card by its identity and SHALL answer unknown when that card is gone or replaced or its stop count differs from the caller's. Because a client may apply focus asynchronously, focusing SHALL read keyboard focus back after the focus request every 25 ms for at most 400 ms, until it is on the requested stop, and SHALL report the index observed then, or none. Pressing SHALL invoke the button only when it still has keyboard focus, answering `false` when it does not. The helper SHALL focus or invoke nothing outside these two card operations, and any client not in front, helper failure, malformed reply or foreground change SHALL be unknown.

#### Scenario: Client not in front
- **WHEN** another app is the foreground window
- **THEN** `composerFocused` answers known `false` and `codexSelectedThread` answers unknown, even if the client keeps an internally focused element

#### Scenario: Codex name over a stale Hub title
- **WHEN** Codex's session index names a thread differently from the slot's Hub title
- **THEN** the adapter compares the selected row with Codex's name, and the result carries only a boolean and a count

#### Scenario: Window process without package identity
- **WHEN** the foreground window's process has no package identity and its image lies in an installed package folder under `<Program Files>\WindowsApps`
- **THEN** the adapter reports that folder's package family, and it reports none for any other location

#### Scenario: Scroll outside the client
- **WHEN** `scrollClient` is called while the client is not in front or the pointer is outside its window
- **THEN** the adapter sends no input and answers known `false`

#### Scenario: Claude approval card open
- **WHEN** Claude Desktop is in front with a permission or question card open, even scrolled out of view, while its composer keeps keyboard focus
- **THEN** the adapter answers approval visibility as known `true` and the router refuses Send

#### Scenario: Codex composer present
- **WHEN** Codex Desktop is in front and its window has exactly one `ProseMirror` composer
- **THEN** the adapter answers approval visibility as known `false`

#### Scenario: Approval selector not qualified
- **WHEN** the router asks whether an approval card is visible while the client is not in front, or while Codex's window has no composer, as when its approval card replaces it, or several
- **THEN** the adapter answers unknown, querying no window when the client is not in front, and the router refuses Send

#### Scenario: Card buttons
- **WHEN** a Claude question card is open with a header button, options, an "Other" row and text field, an enabled footer button and a disabled submit button
- **THEN** `cardButtons` counts only the option rows and the "Other" row, in tree order, as stops, skipping the header, footer, submit and menu buttons and the text field, and reports which one has focus, or none

#### Scenario: Claude permission card stops
- **WHEN** a Claude permission card is open and none of its actionable buttons carries `text-left`
- **THEN** every actionable button is a stop, in tree order

#### Scenario: Focus applied asynchronously
- **WHEN** `focusCardButton` asks Claude to focus a stop and Claude applies the focus 300 ms later
- **THEN** the adapter answers that stop's index, while focus that lands only after 400 ms is not answered as the requested stop: the adapter answers whatever is focused at the bound

#### Scenario: Card press with focus moved
- **WHEN** `invokeCardButton` names a button that no longer has keyboard focus, or a card that was replaced or whose button count changed
- **THEN** nothing is invoked and the adapter answers known `false` for the moved focus and unknown for the changed card

#### Scenario: Codex card not established
- **WHEN** Codex shows no composer and its window does not have exactly one selected sidebar row, as expected but not yet verified for a settings view or a confirmation dialog, or has no on-screen group directly holding a text element and at least two actionable buttons, or several such groups
- **THEN** `cardButtons` answers unknown and nothing is focused or invoked

#### Scenario: Codex card with focus outside its stops
- **WHEN** Codex shows its escalation card while keyboard focus rests on the sidebar row or another button outside the card's stops
- **THEN** `cardButtons` still answers the card, with no stop focused

#### Scenario: Codex card without focus
- **WHEN** Codex shows its escalation card and no element in its window has keyboard focus, as in the 2026-10-05 live check
- **THEN** `cardButtons` answers the card with its two actionable buttons, Deny then approve, as stops and no stop focused, while off-screen message-action groups (one button, no text) and the side strip (buttons, no text) are not candidates

#### Scenario: Native read-only check
- **WHEN** the native Windows check runs
- **THEN** it loads the FFI bindings, reads the foreground identity, pings the UI Automation helper and reads composer, selected-thread, approval, card-button and client-version observations with `SendInput` and `ShellExecute` replaced by throwing guards, and checks the volume key table and that malformed volume requests are refused, with zero guarded attempts

#### Scenario: Volume key with the dictation chord held
- **WHEN** `sendVolumeKey` is called while the adapter holds the dictation chord
- **THEN** it rejects with `keys-held` and sends nothing, and without held keys it sends the requested presses as down and up pairs

### Requirement: Simulated desktop only by explicit flag
`chompi-bridge run` SHALL use the simulated desktop adapter only when given `--desktop sim` together with the routing flags; any other value, or the flag without routing, SHALL be a usage error that opens nothing. Without the flag the bridge SHALL NOT import the simulation modules and SHALL use the platform OS adapter as before. The simulated desktop SHALL implement OS adapter interface version 4 with the same observable behavior the router's adapter tests rely on, including a synthetic system volume and mute that volume keys change without reaching any window, SHALL be branded as simulated, and SHALL hold only synthetic titles and text. A caller of the CLI in the same process MAY receive the simulated controller and desktop the flags created before the router starts; without those flags it receives nothing.

#### Scenario: No flag
- **WHEN** the bridge CLI and package entry are loaded and `run` is given without `--desktop sim`
- **THEN** no simulation module is imported and the platform adapter is used

#### Scenario: Flag without routing
- **WHEN** `run --desktop sim` is given without the routing flags, or `--desktop` names anything but `sim`
- **THEN** the CLI exits with usage code 2 and creates no transport

#### Scenario: Simulated run
- **WHEN** `run --simulate --desktop sim` runs with the routing flags against a synthetic feed
- **THEN** a slot press focuses the task in the simulated desktop, and neither the HID transport nor the platform adapter is created

#### Scenario: Shared adapter contract
- **WHEN** the adapter contract runs against the router tests' fake adapter and the simulated desktop
- **THEN** both meet the same expectations for links, composer focus, cards, scrolling, archives, held keys and volume keys
