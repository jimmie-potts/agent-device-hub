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

## Not established

- **Other card kinds.** Only Claude's question and permission cards and Codex's escalation card were opened.
  The rules assume that other kinds, such as a Codex patch approval, carry the same token (Claude) or also
  replace the composer (Codex). Two other guards remain: the composer-focus re-check before Send refuses while
  focus is on a card's button, and the Hub's `approval` attention refuses Send for the task.
- **A Codex card with its own `ProseMirror` field.** A card that replaced the composer with its own
  `ProseMirror` `Edit`, such as a feedback box, would count as the one composer. If that field held focus with a
  writable value, `composerFocused` would pass too, leaving only the Hub's `approval` attention to block Send.
  No such card was observed.
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
