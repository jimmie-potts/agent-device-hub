# chompi-bridge Specification

## Purpose

Define the CHOMPI bridge transport core: which device it opens, how a device session gates input, how it avoids replay and held controls, how one writer is enforced, and the event and light interface it offers task routing.

## Requirements

### Requirement: Controller matching and session gating
The bridge SHALL open only a HID interface matching VID `1209`, PID `000C`, product string `Agent Controller`, usage page `0xFF00` and usage `0x01`, optionally constrained by serial, and SHALL accept input only after a compatible version 1 `hello` with a nonzero epoch and the expected control, encoder and LED counts. It MUST NOT open MIDI or mass storage interfaces. When several devices match and no serial is configured, it SHALL refuse all of them.

#### Scenario: Stock CHOMPI attached
- **WHEN** the CHOMPI presents as MIDI `0483:5740`
- **THEN** the bridge matches nothing and opens no device

#### Scenario: Incompatible hello
- **WHEN** a matching device sends a `hello` with another version, epoch 0 or wrong counts
- **THEN** the bridge accepts no input from it and reports `unsupported-version` for the version and `incompatible-device` otherwise

### Requirement: Replay-free input with releases on loss
The bridge SHALL drop input from older epochs, duplicate or older sequences within an epoch, repeated presses and unmatched releases. On stale heartbeat, disconnect, epoch change or a firmware host-session restart (a current-epoch `hello` or a dropped host-current flag) it SHALL emit synthetic releases for every held control before reporting the state change, and SHALL ignore input until the device session is healthy again.

#### Scenario: Unplug during a held key
- **WHEN** the device disconnects while a key is held
- **THEN** subscribers receive a synthetic release and a `disconnected` event, and nothing from the old epoch is delivered after reconnect

#### Scenario: Firmware host-session restart
- **WHEN** the device sends a `hello` on the current epoch after a host timeout
- **THEN** the bridge releases every held control, emits one `session-restart` event and resends its current light frame, so lights never stay dark while reported applied

#### Scenario: Bridge restart with device enumerated
- **WHEN** the bridge opens a device that is already enumerated
- **THEN** it stays silent longer than the firmware host timeout, then heartbeats and waits for a fresh `hello` before accepting input

### Requirement: One writer
The bridge SHALL acquire a per-user single-instance lock before opening any device; read-only enumeration needs no lock, and a second instance SHALL exit with a distinct status without opening a device. The lock SHALL be released when the holding process exits, including on kill.

#### Scenario: Overlapping start
- **WHEN** a second bridge starts while the first holds the lock
- **THEN** the second exits with the lock-held status and the first keeps the device

### Requirement: Event and light interface
The bridge SHALL expose a versioned interface with `connected`, `input`, `stale`, `recovered`, `session-restart` and `disconnected` events through bounded subscriptions, and `setLeds` and `setBrightness` commands. A subscriber that overflows SHALL be closed rather than receive a partial stream. Light frames SHALL be sent as two parts with bounded rate and periodic resend. The interface SHALL carry no task semantics.

#### Scenario: Slow subscriber
- **WHEN** a subscriber's queue exceeds its bound
- **THEN** that subscription closes with reason `overflow` and other subscribers are unaffected

### Requirement: Portable core and lazy native transport
The bridge core SHALL run and be tested without native modules. The node-hid transport SHALL load only when the real device transport is selected, and the Windows OS adapter's koffi FFI bindings and PowerShell UI Automation helper SHALL load only when the Windows adapter is used on Windows. On any other platform the bridge SHALL use an unsupported adapter whose observations are all unknown and whose actions reject, so task routing fails closed.

#### Scenario: Linux CI
- **WHEN** the bridge suite runs in CI
- **THEN** no test loads node-hid or koffi, touches USB, opens a link or sends a keystroke to the desktop

#### Scenario: Routing on an unsupported platform
- **WHEN** `run` with a routing profile starts where no Windows adapter applies
- **THEN** every slot press fails closed and nothing is typed or opened

### Requirement: OS adapter contract version 5
OS adapter interface version 5 SHALL report every observation as known or unknown and SHALL compare titles inside the adapter without returning title or conversation text; the only text it returns SHALL be the clients' own model and effort labels. Codex selection SHALL take the thread ID and the slot's Hub title: the adapter SHALL compare the name Codex keeps for that thread ID, read from `session_index.jsonl` in the Codex home (only `id`, `thread_name` and `updated_at`; a thread's last line is its current name), and SHALL use the Hub title only when Codex has never named the thread. It SHALL answer unknown, before any UI query, when the index cannot be read, when the thread's last entry is unusable or older than an earlier entry, when neither name exists, and when any other thread's current name equals the name to compare or any other thread whose current name is unusable has carried it. The Windows adapter SHALL type keys with `SendInput` through koffi FFI, identify the foreground window by package family (the process's package identity, or, when the process has none, the installed package folder its image runs from directly under `<Program Files>\WindowsApps`, as Codex Desktop's window process does; a real package identity always wins), open links through the shell, and use a long-lived PowerShell UI Automation helper for composer focus, the Codex selected row, approval cards and card answers. It SHALL report composer focus as `false` and the Codex selected row as unknown when that client is not the foreground app, SHALL report approval visibility from element class tokens in the client's own foreground window, offscreen elements included and never reading a name or value: Claude as `true` while any element carries the `epitaxy-approval-card` token and `false` when none does, and Codex as `false` only while exactly one `Edit` composer carries the `ProseMirror` token, because its approval card replaces the composer, and unknown when there is none or several. It SHALL report approval visibility as unknown when that client is not the foreground app, when the helper fails or replies malformed, and when the foreground changes during the check. It SHALL read Codex archive filenames and Claude Desktop records by name and key only, SHALL never log, persist or return Codex thread names, SHALL send mouse-wheel input for `scrollClient` only while that client is the foreground app with the pointer inside its window (answering known `false` otherwise, without moving the pointer, clicking or typing), and SHALL release every key it holds on `releaseAll` and `close`. For the system volume (`sendVolumeKey`), the Windows adapter SHALL tap `VK_VOLUME_UP` (0xAF), `VK_VOLUME_DOWN` (0xAE) or `VK_VOLUME_MUTE` (0xAD) 1-10 times in one `SendInput` batch of down and up pairs, as extended keys, without targeting or observing any window (Windows delivers them through the foreground thread's input stream and handles them as a system app command), and SHALL refuse the request without sending while it holds any key, while the user holds a modifier, or when the key or count is invalid. Volume keys SHALL NOT be shortcut key names, so no profile can name them. For card answers the adapter SHALL report the open card's actionable buttons (`cardButtons`), move keyboard focus to one of them (`focusCardButton`) and press the focused one (`invokeCardButton`), in the client's own foreground window and process like the other window checks, returning only counts, indexes and booleans and never reading a name or value. A card's actionable buttons SHALL be its `Button` elements (descendants for Claude, direct children for Codex) that are enabled, support Invoke and do not support ExpandCollapse, in tree order; more than 64 `Button` elements in that scope, counted before this filter, SHALL be unknown; text fields are never among them. A card's wheel stops SHALL be its actionable buttons, except that a Claude card with at least one actionable button carrying the class token `text-left` (a question card's answer rows and its "Other" row) SHALL stop only on those buttons, in tree order, as Up and Down move inside its option list; button counts and indexes SHALL refer to the stops. Each card SHALL carry an identity, its container's UI Automation runtime ID, which is an ID and not window text and which a new card is assumed, not yet shown, never to share. Claude's card SHALL be the one element carrying `epitaxy-approval-card`: none is no card and several are unknown. Codex's card SHALL exist only while its window has no `ProseMirror` composer, exactly one sidebar row `Button` whose class starts with `group relative cursor-interaction` carries `bg-primary-ghost-hover`, and exactly one `Group` that is not offscreen directly holds at least one `Text` element and at least two actionable buttons, which is the card, whether or not any of its buttons has keyboard focus, because Codex does not reliably give its card focus; its stops SHALL be that group's actionable direct-child buttons. Keyboard focus elsewhere, such as on the sidebar row or the card's menu button, SHALL NOT affect the card; then no stop is focused. The search SHALL read one cached list of the window's `Group` elements (class names and offscreen state only), unknown above 512, and one cached list of each on-screen candidate's direct `Text` and `Button` children, never a name or value. One composer is no card; no composer without exactly one selected row and exactly one such group, with zero or several groups, or several composers, is unknown. Focusing and pressing SHALL name the card by its identity and SHALL answer unknown when that card is gone or replaced or its stop count differs from the caller's. Because a client may apply focus asynchronously, focusing SHALL read keyboard focus back after the focus request every 25 ms for at most 400 ms, until it is on the requested stop, and SHALL report the index observed then, or none. Pressing SHALL invoke the button only when it still has keyboard focus, answering `false` when it does not. The helper SHALL focus or invoke nothing outside these two card operations, and any client not in front, helper failure, malformed reply or foreground change SHALL be unknown. For the model and effort knobs, `pickerState` SHALL read, without focusing, invoking, selecting, toggling or setting anything, in the client's own foreground window, only the qualified controls, and SHALL return only their model and effort labels: Claude's one `Menu` named `Model: ...`; Codex's `Select effort` menu and, only while the picker button is expanded, the one other `Menu` whose own entries are all `RadioButton`s; each menu's own `RadioButton` (option), `MenuItem` (action) and `CheckBox` (toggle) entries in tree order (at most 64), their names and selection, the entry holding keyboard focus and whether focus is in the menu; Claude's `Model: ` and `Effort: ` buttons supporting ExpandCollapse (text after the prefix and state; two with one prefix unknown); Codex's picker button, the one ExpandCollapse button under the nearest of up to 8 ancestors of its one composer that holds any, named `Select effort` when several (otherwise unknown), with its name and state; Claude's one `Effort` slider's RangeValue value, range and SmallChange; and the one `StatusBar` inside Codex's picker, parsed as `<label>, <n> of <count>.` and absent in any other shape. No other menu SHALL be read. Every label SHALL be at most 128 characters without control characters. The UI Automation setting actions SHALL each find their target again just before acting and refuse, as unknown, on any difference: `expandSetting` only on a collapsed qualified button; `collapseSetting` only on an expanded Claude button, refusing Codex's picker, which does not close on Collapse; `invokeSelectModel` only on the open picker's one "Select model" entry; `focusMenuEntry` (SetFocus, reading focus back every 25 ms for at most 400 ms) and `selectMenuOption` only on the named qualified menu with the caller's entry count, `selectMenuOption` only on a model option equal to the focused element and answering `false` otherwise; `setSliderValue` only when the slider reads the caller's value, the target is one SmallChange away and within its range; and `focusComposer` only with exactly one composer. These and the two card operations SHALL be the only helper operations that change UI state, and the helper SHALL type nothing. `tapInClient` SHALL tap one chord of profile key names or `Left`, `Right` (extended keys) and `Escape` 1-10 times, only while the named client's window is in front, read again right before `SendInput`, and SHALL answer known `false` and send nothing otherwise; it SHALL refuse, sending nothing, a malformed request, any request while the adapter holds a key, and a physically held modifier. Those three keys SHALL NOT be profile key names. `claudeSettings` SHALL read one Claude Desktop session record's `model` and `effort` keys only, as text of at most 128 printable characters or null, known null without a record and unknown for any other shape.

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
- **THEN** it loads the FFI bindings, reads the foreground identity, pings the UI Automation helper and reads composer, selected-thread, approval, card-button and client-version observations with `SendInput` and `ShellExecute` replaced by throwing guards, checks the volume key table and that malformed volume requests are refused, records each running client's picker state and the UI Automation patterns its controls expose read-only, calling no setting action, and checks the client-tap and chord key tables and that malformed client taps are refused before any attempt, with zero guarded attempts

#### Scenario: Volume key with the dictation chord held
- **WHEN** `sendVolumeKey` is called while the adapter holds the dictation chord
- **THEN** it rejects with `keys-held` and sends nothing, and without held keys it sends the requested presses as down and up pairs

#### Scenario: Client tap only into the client in front
- **WHEN** `tapInClient` is asked to type a chord into Claude while Codex is in front, or the foreground changes between the observation and the input
- **THEN** nothing is sent, and the adapter answers known `false` or unknown

#### Scenario: Picker read
- **WHEN** Codex's `Select effort` picker holds focus with its announcement `GPT-6 Luna Light, 1 of 5.`
- **THEN** `pickerState` answers the qualified menu's kind, label, entries and focused entry, the picker button's state and the announcement as label `GPT-6 Luna Light`, position 1 and count 5, reads no other menu, and changes nothing in the window

#### Scenario: Setting action on a changed target
- **WHEN** `focusMenuEntry` names a menu whose entry count changed, `expandSetting` names a button that is already expanded, or `selectMenuOption` names an option without keyboard focus
- **THEN** nothing is done: the first two answer unknown and the last answers known `false`

### Requirement: Simulated desktop only by explicit flag
`chompi-bridge run` SHALL use the simulated desktop adapter only when given `--desktop sim` together with the routing flags; any other value, or the flag without routing, SHALL be a usage error that opens nothing. Without the flag the bridge SHALL NOT import the simulation modules and SHALL use the platform OS adapter as before. The simulated desktop SHALL implement OS adapter interface version 5 with the same observable behavior the router's adapter tests rely on, including a synthetic system volume and mute that volume keys change without reaching any window, and each client's model and effort controls as the #906 qualifications recorded them, driven by UI Automation actions and keys, with a mode in which each read after a change lags one change behind, shared with the router tests' fake adapter, SHALL be branded as simulated, and SHALL hold only synthetic titles and text. A caller of the CLI in the same process MAY receive the simulated controller and desktop the flags created before the router starts; without those flags it receives nothing.

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
