## Context

The #742 router was built around a verified target. A slot press opened and verified a task, and Record and Send re-checked that same task before any keystroke. Every other event cleared the target. The #743 trial showed the cost: after a profile reload or Back, Send reported `no-target` until a slot key was pressed again, and a task chosen with the mouse could never be sent to.

Three facts from #819 make a press-time model workable:

- The UI Automation helper can tell whether the client in front has its composer focused.
- The helper can tell whether that client shows an approval or question card.
- An open card is exactly the state in which Enter would do something other than send a draft.

The trial also qualified card keyboard behavior on Codex `26.930.3930.0` and Claude `2.19675.0.0` (pickup comment on #821):

- Arrow keys do nothing useful from the composer.
- Shift+Tab needs a varying number of presses to reach the options.
- Claude's free-text "Other" field captures the arrows.

So card navigation uses UI Automation focus and invoke rather than keystrokes.

## Decisions

### State model

- **No target.** The router keeps only:
  - which controls are physically held;
  - whether Record is held and the chord is down;
  - whether a Send or card press is running;
  - the time of the last Send or card press, for the repeat window;
  - the wheel's detent accumulator and pending scroll and step counts;
  - a card observation that the wheel can reuse for at most 500 ms.
- **Slot press.** A slot press still cancels any focus in progress, releases held keys and runs the unchanged target check, link, verification and composer steps. Success is logged and leaves the task in front. It stores nothing that Send or Record read.
- **Generation counter.** The router still bumps a generation counter on every invalidation. A Send that is still checking when a slot key, Back or a loss event arrives is abandoned as `superseded`.

### Send at the press

Send runs a fixed sequence, and each step can refuse:

1. The repeat window (`repeat`), a Send already running (`send-in-progress`) and Record held (`dictating`) are checked first.
2. The router reads the foreground package family. An unknown read refuses as `foreground-unknown`. Any app other than Codex or Claude, or no window, refuses as `not-agent-client`.
3. The version gate. An unknown version refuses as `client-version-unknown`. An unqualified version refuses as `client-unqualified` and logs the observed version.
4. The composer check. Unknown refuses as `composer-unknown`, and not focused refuses as `composer-unfocused`.
5. The approval check. Unknown refuses as `approval-unknown`, and a visible card refuses as `approval-visible`.
6. One Enter. A rejected or timed-out keystroke is logged as `send-uncertain` and never retried.

The repeat window starts before the keystroke, so even an uncertain Enter blocks a second one.

- **Wheel click and Play.** The big-wheel click first asks the adapter for the card state (see below):
  - a card turns the click into a card press;
  - an unknown card state refuses the click as `card-unknown`;
  - no card continues with the Send sequence.

  Play goes straight to the Send sequence, so a visible card refuses it as `approval-visible`.
- **Feed.** Send no longer reads the Hub feed. A stale feed still shows on the slot keys.

### Record

- Record presses the dictation chord down at once and releases it on the Record release, including a synthetic release. There is no foreground, card or composer check.
- A Record press is never refused. It abandons a Send whose checks are still running: the Send captures the Record press counter when it starts, and any Record press or release since then, even a quick tap already released, makes its liveness check fail with `superseded`.
- During a Send's actual Enter keystroke, the chord goes down right after that keystroke completes, so its modifiers can never join the Enter. This was chosen over refusing Record during the keystroke, because the owner wants Record with no checks and the wait is one keystroke (bounded by the adapter timeout). A Record released before that keystroke ends presses nothing.
- If the chord fails to go down, the router releases every held key and logs `record-refused` with `dictation-keys-failed`.
- A release that arrives while the chord is going down still sends the key-up afterwards, as before.

### Card answers

- **Card identity is assumed unique.** Each card is named by its container's runtime ID, and the wheel's choice applies only to that ID. That a new card never reuses an earlier card's ID is assumed, not observed; a multi-question Claude card might keep its container across questions. The installed trial checks it.
- **Card state.** The adapter's `cardButtons(client)` answers in one of three ways:
  - `null` when no card is open;
  - the card's identity (its container's UI Automation runtime ID, an opaque ID and not window text), the number of actionable buttons and the index of the focused one (`null` when focus is on none of them);
  - unknown.
- **Claude's card** is the single element carrying `epitaxy-approval-card`. No such element means no card, and several mean unknown.
- **Codex's card** has no class token, so it is identified by structure from the read-only probe of the escalation card:
  - The card replaces the composer.
  - Keyboard focus starts on one of its buttons.
  - That button's control-view parent is a `Group` that directly holds the card's text and three buttons: two with Invoke, and one menu button with ExpandCollapse only.

  The container is therefore that parent `Group`, and only while all of these hold:
  - the window has no `ProseMirror` composer;
  - exactly one sidebar row is selected: a row `Button` whose class starts with `group relative cursor-interaction` and carries `bg-primary-ghost-hover`, the selector `codexSelectedThread` already relies on. This ties the card to the thread view, so settings pages and dialogs without a selected row never count;
  - the focused element is an actionable button inside the window;
  - the group directly holds at least one `Text` element (the probed card holds two: its prompt) and at least two actionable buttons, including the focused one.

  One composer means no card. No composer without exactly one selected row and such a group, or several composers, means unknown. That Codex settings pages and dialogs have no selected row is expected but unverified; the installed trial opens Codex settings and checks that `cardButtons` reads unknown. The probe printed truncated class lists, so the selected row during an open card was not seen directly; the installed card check confirms it.
- **Actionable buttons** are the card's `Button` elements (descendants of Claude's card, direct children of Codex's group) that are enabled, support Invoke and do not support ExpandCollapse, in tree order. More than 64 `Button` elements in that scope, counted before this filter, is unknown (`card-too-many-buttons`).
  - Excluding ExpandCollapse is stricter than excluding ExpandCollapse-only controls. A menu opens outside the card, where card navigation cannot reach, so the wheel never opens one.
  - `Edit` fields, such as Claude's "Other" text field, are not buttons and are never focused.
  - A disabled button, such as Claude's submit next to an empty "Other" field, is skipped.
- **Index order follows the client.**
  - In the probed Claude question card, the five actionable buttons in tree order are one above the options, the option buttons, and the enabled button after the "Other" field.
  - In the permission card they are its three answers.
  - In the Codex escalation card they are Deny and the button that starts with focus.
- **Wheel turns.**
  - Each turn adds its encoder counts to one accumulator, which restarts at zero whenever a turn reverses its direction. A small wiggle back therefore never steps back.
  - Each full `cards.stepCounts` is one step. Clockwise steps move to later buttons, and steps stop at the first and last button.
  - With no card button focused, which is how Claude cards open while the composer keeps focus, the first clockwise step focuses the first button and the first counter-clockwise step focuses the last.
  - A step calls `focusCardButton(client, cardId, index, count)`. The helper sets focus and replies with the focused index, which updates the reused observation. The client draws its own focus ring.
  - The router remembers the button its own step focused, with the card's identity. That choice is dropped when the wheel sees no card, another card or another app, after a press, on a failed step and on every invalidation.
  - Partial rotation is cleared whenever the wheel acts outside a card (scroll, another app, unknown state, Record), so earlier scroll counts never shorten the first card step. The turn that leads the wheel to observe a new card counts toward that card's first step, because it was made with the card open.
- **Wheel click on a card.**
  - Pressing the wheel clears partial rotation and drops steps not yet sent, and rotation while the click is held is discarded.
  - The click presses the focused button only when all of these hold:
    - the last turn was at least `cards.clickStillMs` before the press (`card-wheel-moving`);
    - no step is in flight (`card-busy`);
    - a button has focus (`card-nothing-focused`);
    - the wheel's own step chose that button on that same card (`card-nothing-chosen`). A step chooses the button focused after it, including a step clamped at the first or last button that leaves focus where it was, so one clockwise turn chooses a Codex card's approve button, which opens focused as the last button; Owner decision on #821: a Codex card opens with its approve button focused, and a click without a turn must not approve it. At least one deliberate step is needed;
    - the repeat window has passed;
    - Record is not held.
  - The press calls `invokeCardButton(client, cardId, index, count)`. The helper answers unknown (`card-changed`) when that card is gone or replaced or its button count changed, and `false` (`card-focus-moved`) when the button no longer has keyboard focus; only then does it invoke.
  - An unknown or timed-out press is logged as `card-press-uncertain` and never retried. The repeat window starts before the call.
- **Unknown states.** An unknown card state makes turns and clicks do nothing. They do not scroll and do not send.
- **Unqualified clients.** An unqualified client version never enters card navigation, because the selectors are version-dependent. Its wheel scrolls as before.
- **Reuse instead of polling.** No LED shows card navigation, so nothing polls the window. Turns reuse a card observation for at most 500 ms, so a fast spin costs one card read per half second. A click always reads afresh.
- **The approval rule is relaxed for one gesture.** The routing contract said a task key press never approves. That stays true for slot keys, Play and Record. A still big-wheel click on a card button the wheel moved to may now approve a permission request, as the owner decided on #744 and #821. It is a client UI action, never a Hub acknowledgement.

### Detents

- The CHOMPI firmware reports one count per quadrature cycle, and the big wheel turns smoothly. One slow full turn each way on the trial device on 2026-10-05 measured about 25 counts per revolution (net +28 clockwise and -22 counter-clockwise, every delta ±1).
- The default of 6 counts per step is therefore about a quarter turn, with 250 ms of click stillness. Both are profile fields (`cards.stepCounts` 1-96, `cards.clickStillMs` 0-2000). `DEFAULT_CARD_STEP_COUNTS` in `profile.ts` is the one place the step default lives; the shipped profile does not repeat it. #821's installed trial checks the feel, and later fine-tuning is a profile edit.
- There is no separate decay setting: partial rotation stays until a reversal, a wheel press or any wheel action outside a card clears it.

### Lights

- Slot keys show task state only. A "selected" key would have to follow the mouse, so it is removed along with the target.
- The wheel's Send-readiness LEDs depended on the target's Hub state, and showing readiness for the window in front would need polling, so they are removed.
- The wheel LEDs light only to report a refusal (owner decision on #821, issuecomment-5999101534): a refused or uncertain Send or card press flashes both in the error color for `timing.errorFlashMs`. A `repeat` (a bounce right after a successful Send) and `superseded` (Record pressed on purpose) do not flash, because neither is a failure. The router's existing render tick ends the flash; nothing polls the desktop. This restores the device feedback the old target model gave through the slot key's error flash.
- A refused slot press still flashes its key.

### Profile compatibility

- `cards` and both of its fields are optional, with defaults.
- `colors.selected`, `colors.sendReady` and `colors.sendBlocked` are accepted when present and ignored, so the installed trial profile, which has them and `send: [33, 27]`, keeps loading.
- The shipped profile drops them and leaves `cards` to the code defaults. `schemaVersion` stays 1.

### Adapter contract

- Interface version 3 adds three methods, so the routing core's equality gate on `OS_ADAPTER_VERSION` moves with the constant.
- The helper protocol number stays 1, because the helper ships beside the adapter that calls it.
- Each operation runs against the client's own foreground top-level window and process (`TargetWindow`) with bounded `FindAll` calls under a `CacheRequest`, like the existing window checks. It returns only counts, indexes, booleans and the card's runtime ID. It never reads a Name or Value.
- The helper starts from a short `-EncodedCommand` loader that reads the script file named in the `CHOMPI_UIA_HELPER_SCRIPT` environment variable. The script with the card operations no longer fits a Windows command line as base64 UTF-16, and passing the path in the environment means no character in it, typographic apostrophes included, can end a PowerShell string.
- The helper's other operations stay read-only. A static test pins `SetFocus` to `FocusCardButton` and `Invoke` to `InvokeCardButton`.

## Cut assurances and residuals

These cuts are deliberate (owner decision on #821, 2026-10-05).

- **No Hub check on Send.** Hub `approval` attention and a stale feed no longer block Send, and Send no longer identifies the task in front. Send relies on the bridge's own card check and the composer check. A permission request the Hub reports but the window does not show, for example in another task, no longer blocks a Send to the task in front.
- **A Codex card with its own focused `ProseMirror` field accepts Enter.** Such a card would count as the one composer, so the card check answers no card and the composer check passes. Enter then reaches that field, as a keyboard would. No such card was observed.
- **Record works anywhere.** Record holds the chord whatever is in front, including in a card's free-text field and in other apps. Wispr decides where the text goes.
- **Codex card identification is structural, narrowed.** A Codex view counts as a card only with no composer, exactly one selected sidebar row (the thread view) and a focused button whose parent group directly holds text and at least two actionable buttons. Settings pages and dialogs without a selected row are excluded. A residual remains: another composer-less element of the thread view with that shape would count as a card. A press there still needs a deliberate wheel step to that button and a still click. Only the escalation card was observed.
- **Claude card focus after a press.** After a press, Claude may leave keyboard focus off the composer, and Send then refuses as `composer-unfocused` until the owner clicks into the composer or presses the task's slot key.

## Failure and recovery

- Every unknown observation refuses and types nothing.
- Uncertain keystrokes and card presses are never retried.
- Loss events, Back, a profile swap and shutdown release every held key and drop pending wheel steps and the reused card observation. Nothing pressed before them is replayed. After a reconnect, each control acts only on a fresh press, evaluated at that press.

## Acceptance examples

| Example | Test |
| --- | --- |
| Send and Play type one Enter to the Codex or Claude task in front with no slot press, and after a profile reload or Back | `routing-router.test.mjs` |
| Send refuses another app (`not-agent-client`), an unknown foreground, an unqualified or unknown version, a missing or unknown composer, a visible or unknown card, Record held, and a repeat within the window across the wheel and Play | `routing-router.test.mjs` |
| Hub `approval` attention and a stale feed no longer block Send (cut) | `routing-router.test.mjs` |
| Uncertain Enter is not retried; a disconnect replays nothing and a fresh click after reconnect is a new press | `routing-router.test.mjs` |
| Record holds the chord with any app in front and during a card, releases it on release and loss, supersedes a Send still checking and presses right after an Enter being typed | `routing-router.test.mjs` |
| Card steps: one per threshold, reversal restarts the count, a wiggle back never steps back, the first step from an unfocused card, clamping at the ends | `routing-router.test.mjs` |
| Card press: a still click presses the button the wheel moved to once; a click within the stillness time, with nothing focused, on a button the wheel did not move to (a Codex card's initially focused approve button, focus moved by the mouse, a new card) or with focus moved presses nothing; Play is refused; an uncertain press is not retried | `routing-router.test.mjs` |
| Scroll counts never shorten the first card step | `routing-router.test.mjs` |
| A refused or uncertain Send or card press flashes both wheel LEDs in the error color for the flash time | `routing-router.test.mjs`, `routing-lights.test.mjs` |
| The wheel is inert when the card state or Codex container is unknown, scrolls again after the card closes, and an unqualified client scrolls | `routing-router.test.mjs` |
| Profile: optional `cards` defaults and bounds, legacy colors accepted and ignored, the shipped profile | `routing-profile.test.mjs` |
| Lights: no selected key, and wheel LEDs only for a refusal flash | `routing-lights.test.mjs`, `routing-router.test.mjs` |
| Adapter: card replies parsed for both clients (card with identity, none, unknown, malformed, wrong window), a Codex card needing exactly one selected row, focus and press arguments and card identities validated, a changed card unknown, nothing queried when the client is not in front | `windows-adapter.test.mjs` |
| Helper: the card operations are scoped by `TargetWindow`, read no Name or Value, check the Codex selected row, text child and direct buttons and the card identity, and are the only places that focus or invoke; the loader takes its path from the environment | `windows-uia-helper.test.mjs` |
| The card read runs read-only against the live windows | `native.mjs` (native Windows check) |
