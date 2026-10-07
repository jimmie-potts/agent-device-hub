# UI Automation notes

These notes record the UI Automation structure the helper in `uia-helper.ps1` relies on. It was found on
October 3-4, 2026 by read-only probing of the running Desktop clients: Codex `26.930.3930.0` and Claude
`2.19675.0.0`. The probe printed control types, class names, redacted AutomationIds, pattern flags and name
lengths. It never printed a Name or Value, sent input, clicked, focused or invoked a pattern. A client update
can change any of this. Re-qualify it alongside the bridge's qualified-version list.

## Both clients

- Both clients are Electron windows (`Chrome_WidgetWin_1`). The web content is a `Document` with AutomationId
  `RootWebArea`. UIA reports the main process ID for every element, including those rendered in a renderer
  process.
- The window title is static, so the helper never reads it.
- Chromium keeps a focused element inside a background window. `AutomationElement.FocusedElement` named the
  Codex composer `Edit` while an unpackaged terminal was the Win32 foreground window. So the adapter first
  checks `GetForegroundWindow` and the package family (Codex's window process has no package identity, so the
  adapter takes its family from its `WindowsApps` package folder). It sends the helper a request only for the client's
  own foreground top-level window (`GA_ROOTOWNER`), and checks the foreground again after the reply.
- Walking the Codex tree with `TreeWalker.ControlViewWalker` loops back into the window's own subtree under a
  `RootView` pane. `FindAll` does not loop, so the helper uses `FindAll` with conditions, plus a bounded
  parent walk.
- Neither client's managed UIA client exposes ARIA properties (`aria-current`, `aria-selected`).

## Codex

- One `RootWebArea` document. Its Name is the selected thread's title. Probe evidence: it equals exactly one
  sidebar row's Name, and only that row has the active class token.
- Sidebar task rows are `Button` elements whose ClassName starts with `group relative cursor-interaction`.
  The Name of each row is its thread title alone. Status and the archive and pin buttons are separate child
  elements.
- The selected row is the only row whose class list contains `bg-primary-ghost-hover`. No row supports
  `SelectionItemPattern`.
- The helper's `codexSelectedTitle` operation (behind the adapter's `codexSelectedThread`, which supplies the
  thread's name) reports `matches` only when there is exactly one selected row, and both its Name and the
  document Name equal the title (ordinal comparison). `sameTitleRows` counts every rendered row with that Name.
  Rows in collapsed projects are not rendered, so they are not counted. Zero or several selected rows return
  `unknown` (`selected-row-count`).
- Live read-only check: a random title gave `matches: false, sameTitleRows: 0`. The selected title, compared in
  memory and never printed, gave `matches: true, sameTitleRows: 1`. One character short gave
  `matches: false, sameTitleRows: 0`.
- Composer: a single `Edit` with class `ProseMirror` (`ProseMirror-focused` when focused), with a writable
  `ValuePattern`. It is the only editable element in the window.

## Claude

- Two `RootWebArea` documents: an empty one and the app. The window's Code tab is a selected `RadioButton`
  (`SelectionItem`), and the sidebar is a `complementary` group.
- Composer: an `Edit` with class `tiptap ProseMirror` and a writable `ValuePattern`. Its accessible name is a
  fixed UI label, which the helper does not read.
- Claude selection is verified from the session store's `lastFocusedAt`, not from UIA.

## Composer focus rule (both clients)

`composerFocused` is true only when all of these hold:

- the client's package owns the foreground window;
- the focused element's process is that window's process;
- a bounded parent walk reaches that window;
- the element is an `Edit` with the class token `ProseMirror` and a writable `ValuePattern`.

## Approval cards

Found on October 5, 2026 during the #743 trial, on Codex `26.930.3930.0` and Claude `2.19675.0.0`, by the same
kind of read-only structure probe. Throwaway tasks opened the cards; the probe ran before, during and after each one.

- **Claude.** An `AskUserQuestion` question card and a Bash permission card each render as exactly one `Group`
  whose class list contains the token `epitaxy-approval-card`. It sits in the approval dock above the composer.
  The composer `Edit` (`tiptap ProseMirror`) stays present and keeps keyboard focus while the card is open, so
  composer focus alone cannot block Send. After the card closes, no element carries the token.
- **Codex.** The escalation approval card has no distinctive class token. It replaces the composer: while it is
  open, the window has no `Edit` with the `ProseMirror` token, and keyboard focus is on one of the card's
  `Button`s, which Enter would activate. Before and after, the window has exactly one such `Edit`, focused.
  Only this escalation card was observed. The owner's Codex configuration never asks for approval, so the card
  appeared only after one throwaway task was switched to an asking mode.

The helper's `approvalVisible` operation runs against the client's own foreground window and process, as
`composerFocused` does, and refuses any other window (`window-mismatch`). It runs one `FindAll` over the window's
control-view descendants, caches only `ClassName` and counts the elements that carry the token. For Claude it
checks every element, whatever its control type, so a card that stops being a `Group` still counts. For Codex it
checks only `Edit` elements. Offscreen elements count, so a pending card scrolled out of view still blocks Send.
It never reads a Name, Value or focus. The adapter decides:

- Claude: `true` when at least one card exists, `false` when none does.
- Codex: `false` only when exactly one composer exists. No composer is `unknown` (`codex-composer-absent`)
  rather than `true`: the evidence shows that a card removes the composer, not that a missing composer means a
  card, because another view could hide it too. Several composers are `unknown` (`codex-composer-count`). The
  router refuses Send on every answer except `false`.
- Either client not in front is `unknown` (`<client>-not-foreground`), as is any helper failure, malformed
  reply or foreground change during the check.

Re-qualify both selectors, with a card open in each client, when either client's version changes or a new kind
of card appears.

## Card answers

Added for [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821). The big wheel answers an open card
through UI Automation focus and invoke.

### Keyboard qualification

Probed live on October 5, 2026, in throwaway tasks, on Codex `26.930.3930.0` and Claude `2.19675.0.0`.

- **Claude question card:**
  - Arrow keys do nothing while the composer has focus. In the composer, Up and Down walk the prompt history.
  - Shift+Tab from the composer reaches the options only after a varying number of presses.
  - Once focus is in the option list, Up and Down move between options. The last option is a free-text "Other"
    field that captures the arrows.
  - Enter on a focused option picks it.
- **Codex escalation card:**
  - Focus started on a card button in that probe, but not reliably: in installed check 4 nothing had focus (see
    "Live findings"). Shift+Tab moves to Deny, and Tab leaves the card.
  - Down scrolls the chat.
  - Enter on the focused button activates it (Deny was declined).

Keystroke navigation is therefore unreliable: the composer history and the "Other" field capture the arrows, and
the number of Shift+Tab presses varies. The helper moves focus and presses buttons directly instead. The client draws
its own focus ring.

### Operations

Three helper operations serve the adapter's `cardButtons`, `focusCardButton` and `invokeCardButton`. Each one:

- runs against the client's own foreground top-level window and process (`TargetWindow`), like the other window
  checks, and refuses any other window (`window-mismatch`);
- finds the card container (below);
- lists the card's actionable buttons with one bounded `FindAll` of `Button` elements under a `CacheRequest`
  (descendants of Claude's card, direct children of Codex's group).

The operations return counts, indexes, booleans and the card's identity only. They never read a Name or Value. The
identity is the container's UI Automation runtime ID joined with dots: an opaque ID, not window text. That a new card
never shares it is an assumption (see "Not established").

- **Actionable buttons:**
  - enabled `Button` elements that support Invoke and do not support ExpandCollapse, in tree order;
  - more than 64 `Button` elements in that scope, counted before any filter, is an error (`card-too-many-buttons`);
  - text fields are `Edit` elements and are never listed;
  - a disabled button, such as Claude's submit beside an empty "Other" field, is skipped;
  - menu buttons (ExpandCollapse) are skipped because their menus open outside the card.
- **Stops:** the wheel steps between the card's stops, and counts and indexes refer to them.
  - A Claude card with at least one actionable button carrying the class token `text-left` stops only on those
    buttons, in tree order: a question card's answer rows and its "Other" row. Up and Down move the same way inside
    the option list.
  - Any other card, such as a Claude permission card or a Codex card, stops on every actionable button.
  - The token is matched exactly (`HasToken`) on the cached class list; no text is read.
- **`cardButtons`** returns `{ cards, buttons, focused, cardId }`, plus `composers` and `selectedRows` for Codex.
  `focused` is the index of the listed button that equals `AutomationElement.FocusedElement` (`Automation.Compare`),
  or -1.
- **`focusCardButton(cardId, index, count)`** refuses an invalid index (`invalid-card-index`), no card
  (`card-absent`), another card or a button count that differs from `count` (`card-changed`); the adapter reports
  these as unknown. It then sets keyboard focus on that stop and reads focus back every 25 ms, for at most 400 ms on a
  `Stopwatch`, until focus is on that stop. It returns the index it observed, or -1. Claude applies focus
  asynchronously (see "Live findings"), and 400 ms stays well inside the adapter and helper timeouts. The router's
  step stays in flight during the read-back, so a still click in that time is refused (`card-busy`) and presses
  nothing: fail-closed, and the next click after the step completes works.
- **`invokeCardButton(cardId, index, count)`** runs the same checks (unknown when they fail), then presses the
  button only when it equals the focused element, and returns `{ invoked: false }` otherwise.

These two are the only helper code that changes UI state. A static test pins `SetFocus` to the first and `Invoke` to
the second. The bridge starts the helper with a short `-EncodedCommand` loader that reads `uia-helper.ps1` from the
path in the `CHOMPI_UIA_HELPER_SCRIPT` environment variable, because the script with these operations no longer fits a
Windows command line as base64 UTF-16. The path is never embedded in a PowerShell string, so no character in it,
typographic apostrophes included, can end one.

The router presses only a button its own wheel step chose, on the same card (by `cardId`), so a Codex card's
initially focused approve button is never pressed by a click alone. A step clamped at an end, which cannot move focus,
chooses nothing, so that approve button is pressed only after the wheel moves away and back onto it.

### Card containers

- **Claude** (question and permission cards): the one element of any control type carrying `epitaxy-approval-card`.
  - In the probe, the permission card's three answers are `cds-reset group/btn` buttons. That they lack `text-left`,
    so that all three are stops, is inferred: the probe truncates those long class lists. Installed check 5 in the
    qualification report confirms it.
  - A question card's actionable buttons are, in tree order: a header button, the option rows, the "Other" row and a
    footer button. Its disabled submit button and its menu button are skipped. The option rows (`... rounded-[5px]
    px-md py-md text-left ...`) and the "Other" row (`... text-body text-primary text-left ...`) carry `text-left`,
    and the header and footer (`cds-reset group/btn ...`) do not, so the stops are the option rows and "Other".
  - The composer keeps focus when either card opens, so `focused` starts at -1.
  - No token element is no card. Several are unknown (`card-count`).
- **Codex** (escalation card): the card has no class token, and Codex does not reliably give it keyboard focus, so it
  is found by structure alone. In the probes, the card is an on-screen `Group` (class `contents`) that directly holds
  two `Text` elements (the card's prompt) and three buttons: Deny and approve (both Invoke) and a menu button
  (ExpandCollapse only). Other groups with buttons do not match: off-screen message-action groups (class `contents`)
  hold one button each and no text, and a side strip group (`absolute top-1/2 left-3 ...`) holds about ten buttons
  and no text children.
  - The container is the one `Group`, while all of these hold:
    - the window has no `ProseMirror` composer;
    - exactly one sidebar row is selected: a `Button` whose class starts with `group relative cursor-interaction` and
      carries `bg-primary-ghost-hover`, as in the selected-row rule above. This ties the card to the thread view, so
      settings pages and dialogs without a selected row never count. One `FindAll` of `Edit` and `Button` elements,
      caching class names and control types only, counts composers and selected rows;
    - exactly one `Group` that is not offscreen directly holds at least one `Text` element and at least two
      actionable buttons. One `FindAll` of the window's `Group` elements caches class names and offscreen state
      only (more than 512 is unknown, `card-too-many-groups`). Each on-screen group's direct `Text` and `Button`
      children are read in one cached `FindAll` (a group with more than 64 `Button` children is not a candidate).
  - Keyboard focus does not decide the card. Codex may leave focus on the sidebar row after a thread opens, or the
    owner may focus the card's menu button or anything else; the card stays established and `focused` is -1 until a
    stop has focus. Safety does not rest on focus here: a press needs a wheel step that the read-back confirms on a
    stop, a fresh focus read at the click and a `Compare` with the focused element before `Invoke`.
  - The stops are the group's actionable direct-child buttons in tree order (Deny, then approve). `focused` is the
    focused stop's index, or -1 when nothing in the card has focus. With no focus, the first clockwise step focuses
    Deny and a counter-clockwise step focuses approve.
  - The adapter decides:
    - one composer is no card;
    - no composer and not exactly one selected row is unknown (`codex-selected-row-count`);
    - no candidate group is unknown (`codex-card-unestablished`) and several are unknown (`codex-card-ambiguous`);
      the wheel then does nothing;
    - several composers are unknown (`codex-composer-count`).
  - Seen live: installed check 4 read one selected sidebar row while the card was open.
  - Unverified: that Codex settings pages and dialogs have no selected sidebar row, so they read unknown. The
    installed trial opens Codex settings and checks that `cardButtons` reads unknown.
  - Nearest non-card shape: the thread scroll layout (`group/thread-scroll-layout ...`) directly holds many `Text`
    elements (59 in the probe with the card) and one actionable `Button`, so it is not a candidate. If it gained a
    second actionable direct `Button` while a card is open, the read would find two candidates and stay unknown
    (`codex-card-ambiguous`, an inert wheel).
  - Residual: in a composer-less thread view without a card, another single on-screen group with the same shape,
    such as that layout with a second actionable button, would count as a card. A press there still needs a
    deliberate wheel step to the button and a still click. Only the escalation card was observed.
  - A very long thread can hold more than 512 `Group` elements; the read is then unknown (`card-too-many-groups`)
    and the wheel is inert on a card there. The installed checks include a long thread.

Re-qualify the containers, the stops (a Claude question card stops on its answers only, a permission card on all its
buttons), the focus read-back and a still-click press, with a harmless card in a throwaway task, when either client's
version changes. If Claude renames `text-left`, question cards fall back to every actionable button, which is wider
but still safe.

### Live findings (2026-10-05)

The installed bridge was checked on a Claude question card with three options:

- **Asynchronous focus.**
  - The wheel logged `card-step` for buttons 1 to 3, but every still click was refused as `card-nothing-chosen`.
  - Probing the open card directly with the installed helper: before the step, `cardButtons` gave 6 buttons and no
    focus. `focusCardButton` for button 2 replied that nothing was focused, and 300 ms later `cardButtons` reported
    button 2 focused.
  - Claude applies focus asynchronously, so the helper now reads it back in the bounded poll above.
- **Codex card without focus.** In installed check 4 (Codex escalation card, installed d1ea6a8), the wheel was inert
  and the bridge logged `codex-card-unestablished`. A read of the card gave no composer, one selected row and no
  card, and no element in the window had keyboard focus: the earlier rule started from the focused card button. The
  card is now found by structure, as above.
- **Shift+Tab stops.** The wheel walked all six actionable buttons, the same stops as Shift+Tab, including the
  header and footer buttons. The owner expects the answers only, as Up and Down inside the option list, which led to
  the `text-left` stop rule above.

## Model and effort controls

Added for [#906](https://github.com/jimmie-potts/agent-device-hub/issues/906). Knob 1 sets the model and knob 2 the
effort through the clients' own controls, with UI Automation actions wherever the client allows it.

### Live qualification (2026-10-06)

Two rounds on the trial host, in throwaway tasks, on Claude Desktop `2.19675.0.0` and Codex Desktop `26.930.3930.0`.

**Keyboard round.** The owner pressed the keys and the coordinator read the result with a read-only snapshot.

- **Claude:**
  - `Ctrl+Shift+I` opens a `Menu` named `Model: <current>` of model `RadioButton`s (the current one `IsSelected`) and
    a "More models" `MenuItem`. Enter on a focused option applies it, and the session record's `model` updates within
    about 1 s.
  - `Ctrl+Shift+E` opens a `Slider` named `Effort`. With Haiku 4.5 there is no Effort button.
- **Codex:** `Ctrl+Shift+M` opens a `Menu` named `Select effort` holding:
  - a "Select model" `MenuItem`;
  - a fast mode `CheckBox`;
  - "Reset to default" and "Power" `MenuItem`s;
  - a `StatusBar` announcing `<model> <level>, <n> of <count>.`, whose count differs by model.
  
  "Select model" opens the model list. A pick returns to the picker, which stays open.
- **Codex chords:** the owner's `Ctrl+Alt+=` and `Ctrl+Alt+-` step the level. `Ctrl+Alt+-` splits a Claude pane.

**UI Automation round** ([comment](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6027688512)).
The owner watched while the coordinator used patterns.

- **Claude:**
  - The `Model: <name>` button supports `ExpandCollapse`. Expand opens the menu, and Collapse closes it with no change; focus then sits on the button.
  - The menu's initial focus varies: sometimes the `Menu`, sometimes the selected option.
  - Model options support `Invoke` and `SelectionItem`. `Select()` applied a model and closed the menu, and the button then named it.
  - The `Effort: <level>` button supports `ExpandCollapse`.
  - The `Effort` slider supports `RangeValue`: 0-5, `SmallChange` 1, writable. `SetValue(2)` changed Medium to High at once, and the record's `effort` read `high` within a second.
- **Codex:**
  - The picker button reads `<model> <effort>` while collapsed (for example `GPT-6 Luna Extra High`), so it gives model and effort readback without opening anything.
  - Expand opens the `Select effort` menu. "Select model" supports `Invoke`, and model options support `SelectionItem`; `Select()` applied a model and returned to the picker.
  - Collapse does not close the picker, but one Escape into it does.
  - Power supports `Invoke` only, with no `RangeValue`.
  - The owner's `Ctrl+Alt+=` changed the button's name to the next level.
- **Leaving the model list** (observed 2026-10-07, S906-4 on
  [#915](https://github.com/jimmie-potts/agent-device-hub/pull/915)): `Select()` on the current model (`IsSelected`)
  does nothing; the list stays open. `Invoke()` on it returns to the `Select effort`
  picker unchanged, and the picker then reports no keyboard focus, so the close moves focus into it before its one Escape.
- **Owner decision:** Codex effort uses the owner's chords, confirmed from the picker button's name. The picker's Power entry is only the fallback when no chords are configured.

### Operations

The helper reads with `pickerState` and acts through eight setting operations. None of them types; the adapter's
`tapInClient` sends the few keys the flows still need. Every operation runs against the client's own foreground window
and process (`TargetWindow`).

- **Qualified shapes only (F3 on #915).** `pickerState` reads no other menu:
  - Claude's one `Menu` named `Model: ...`;
  - Codex's `Select effort` menu, and, only while the picker button is expanded, the one other `Menu` whose own
    entries are all `RadioButton`s (the model list);
  - Claude's `Model: ` and `Effort: ` `Button`s with `ExpandCollapse`, read from one cached `FindAll` (two with one
    prefix is `composer-setting-count`);
  - Codex's picker button (F5 on #915): among all the `ExpandCollapse` `Button`s under the outermost of up to 8
    ancestors of its one `ProseMirror` composer, the one named `Select effort` (expanded) or `<model> <effort>`
    (collapsed), whose name ends, after at least one word, with a known effort label (Minimal, Low, Medium, High, Extra
    High, Light, Standard, Extended, Max or Ultra, any case). The composer area also holds "Add files and more" and
    "Change permissions", which are never taken for it. None is no button, and several is
    `codex-picker-button-ambiguous`. The labels only find this button; levels are never listed from them;
  - Claude's one `Slider` named `Effort`, with its `RangeValue` value, range and `SmallChange`;
  - the one `StatusBar` inside Codex's picker.
  
  A menu's entries are its own `RadioButton`, `MenuItem` and `CheckBox` descendants (not a nested menu's), at most 64,
  with `SelectionItem.IsSelected` or `ToggleState`. Each menu also reports the entry holding keyboard focus and whether
  focus is in it. Labels are trimmed to 128 characters, and the adapter refuses control characters.
- **Fresh read before every action.** Each action finds its target again and refuses on any difference, so a stale
  read in the bridge can never make it act twice or on another element:
  - `expandSetting` acts only on a `Collapsed` button;
  - `collapseSetting` acts only on an `Expanded` Claude button, and refuses Codex (`collapse-unsupported`);
  - `invokeSelectModel` acts only while the `Select effort` menu is open with exactly one "Select model" entry;
  - `focusMenuEntry`, `selectMenuOption` and `invokeCurrentOption` need the named qualified menu with the caller's entry
    count. `invokeCurrentOption` acts only on the Codex model list's selected option, to leave the list unchanged.
    `selectMenuOption` also needs an option that equals the focused element (`Automation.Compare`), like
    `invokeCardButton`, and answers `false` otherwise;
  - `setSliderValue` needs the slider to read the caller's value, a step of exactly `SmallChange` and a target within
    its range;
  - `focusComposer` needs exactly one composer.
  
  Each action reads its effect back every 25 ms for at most 400 ms.

### Residual windows

These windows remain after the keystroke-free design (F2 on #915). Each lies between a confirming read and the
action, and is about one helper round trip: typically tens of milliseconds, at most the 2 s adapter call timeout.

- **Codex's closing Escape:** the bridge sends it only after a fresh read shows the `Select effort` picker holding
  focus, through `tapInClient`, which re-reads the foreground right before `SendInput`. If the owner closes the
  picker or moves focus inside that window, the Escape reaches whatever has focus in Codex. That is usually the
  composer, where Escape sends nothing. Whether that Escape interrupts a running Codex turn is not qualified, so it
  could. It never answers a card: the knobs refuse while a card is open.
- **The owner's chords:** sent only with Codex in front, no card and the picker closed, checked just before. A card
  that opens inside that window would receive the chord.
- **Right and Left on Power (no chords):** sent only while a fresh read shows Power focused. If focus moves inside
  that window, the arrow reaches the newly focused element in Codex.
- **UI Automation actions:** inside the helper, the gap between the fresh read and the pattern call is a few
  milliseconds, and the call acts on the element itself, not on whatever has focus.

The knobs send no Enter, and none of these keys can send a prompt.

## Not established

- **Other card kinds.** Only Claude's question and permission cards and Codex's escalation card were opened.
  The rules assume that other kinds, such as a Codex patch approval, carry the same token (Claude) or also
  replace the composer (Codex). One other guard remains: the composer-focus check before Send refuses while
  focus is on a card's button. Since #821, Send no longer checks the Hub's `approval` attention.
- **A Codex card with its own `ProseMirror` field.** A card that replaced the composer with its own
  `ProseMirror` `Edit`, such as a feedback box, would count as the one composer. If that field held focus with a
  writable value, `composerFocused` would pass too, and Send would type Enter into that field, as a keyboard would.
  The owner accepted this residual on #821. No such card was observed.
- **Card identity across cards.** The card answers assume that a new card's container never has the runtime ID of
  an earlier card's, so a wheel choice cannot carry over. Chromium is expected to give each new accessibility node a
  new ID, but this was not observed live. In particular, a Claude question card with several questions may keep its
  container while it moves to the next question; then a choice made on one question would still match. The installed
  trial answers a multi-question Claude card with the wheel and checks that a click after a question change, without a
  new step, presses nothing.
- **Other card shapes.** Only the question card with single-choice option rows and the permission card were probed.
  Any other Claude card shape, for example a multi-select question with checkboxes, has no `text-left` buttons as far
  as is known and falls back to every actionable button as a stop.
- **The picker read and the setting actions against the live clients.** The qualification used the coordinator's
  own pattern calls, not the helper's operations. Still to observe with the helper (#745's installed checks):
  - each menu and the slider are descendants of the client's window rather than a separate popup;
  - exactly one `ExpandCollapse` button near Codex's composer has the picker's name (the selector found by name);
  - `RangeValue.SmallChange` and `SetValue` behave as qualified;
  - the picker announcement is the `StatusBar`'s name or its first `Text` child;
  - Claude's composer takes focus from `SetFocus` after a Collapse or a pick.
  
  Any of these failing makes a knob refuse or report `unverified`, rather than act.
- **Codex's level range with chords.** Codex's picker button carries no range, so a chord at an end reads as
  `mismatch` (`unchanged`), which an unbound chord would also give. The Power fallback reads the range from its
  announcement.
- **Split panes, pop-out windows and several Codex windows.** These were not observed. A pop-out could hold
  its own composer.

## Adapter caches and their staleness

- **Client versions** come from `Get-AppxPackage` through the helper. The cache is dropped when:
  - the helper restarts;
  - 10 minutes pass;
  - a foreground check sees a client under a process ID it has not seen for that client. This covers the first sighting after start-up and every restart, such as a self-update relaunch.

  A fetch that is in flight when a new process ID appears is not trusted afterwards. Two cases remain stale, each bounded:
  - A client that restarts on a new version without coming to the foreground keeps its cached version until it is seen in the foreground or the 10 minutes pass.
  - The press that first brings the new process to the foreground passed the version gate on the cached value, because the gate runs before the link opens. The next gate check fetches again.
- **The Codex archive** is a set of archived thread IDs from one directory scan. A complete scan replaces the previous set and answers, positive or negative, for 10 seconds. After that, the next lookup rescans, and concurrent lookups share that scan. Archiving or unarchiving therefore shows within one TTL after the next lookup. A scan that runs over its 1-second bound, or fails, never replaces the set. It answers only the archived IDs it read, and returns `unknown` for anything else.
