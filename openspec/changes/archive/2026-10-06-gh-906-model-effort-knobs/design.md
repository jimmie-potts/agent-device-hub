## Context

The router maps the slot keys, Record, Send, Loop, the big wheel, knob 4 (pages and the Attention click) and the volume knob; knobs 1-3 were inert. The OS adapter (interface version 4) typed only allowlisted shortcut keys through `sendKeys`, plus the volume keys, and its UI Automation helper returned counts, indexes and booleans, never text.

On 2026-10-06 the owner decided that knob 1 sets the model and knob 2 the effort ([#744](https://github.com/jimmie-potts/agent-device-hub/issues/744)). Two qualifications followed on the trial host, both on Claude Desktop 2.19675.0.0 and Codex Desktop 26.930.3930.0.

- **Keyboard round** ([#906](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6023440454)): the clients' shortcuts open the model menu, the Effort slider and Codex's picker, and readback exists for both.
- **UI Automation round** ([#906](https://github.com/jimmie-potts/agent-device-hub/issues/906#issuecomment-6027688512)), after the #915 reviews:
  - **F1:** a lagging UI Automation read could send a second Escape into the composer.
  - **F2, S906-2:** a key could leave the menu between the confirming read and the keystroke.
  - **A1:** Claude effort kept pressing Right at its range end.
  
  This round recorded the patterns the bridge now uses:
  - **Claude:** the `Model:` and `Effort:` buttons support ExpandCollapse, model options support SelectionItem, and the Effort slider supports RangeValue (0-5, SmallChange 1).
  - **Codex picker button:** it reads `<model> <effort>` while collapsed and supports ExpandCollapse. "Select model" supports Invoke and model options support SelectionItem. Collapse does not close the picker, but one Escape does. Power supports Invoke only.
  - **Owner decision:** Codex effort uses the owner's chords (`Ctrl+Alt+=` and `Ctrl+Alt+-`), sent only with Codex in front, no card and the picker closed, confirmed from the picker button's name; Power is the fallback without chords.

## Decisions

### Adapter interface version 5

The interface is unreleased, so it stays at version 5 with a revised contract.

- **`pickerState(client)`: qualified shapes only (F3).** It returns:
  - the open qualified menu: Claude's `Model: ...` menu, Codex's `Select effort` picker, or the model list, which counts only while the picker button is expanded and only when all its own entries are model options;
  - each menu's entries, focused entry and whether focus is in it;
  - Claude's `Model:` and `Effort:` buttons (text after the prefix, expanded state) or Codex's picker button (name, state);
  - Claude's slider range;
  - Codex's announcement.
  
  No other menu is read, so task or project names from another menu cannot cross. Labels are model and effort labels only, at most 128 characters without control characters. Codex's picker button is identified by name among all ExpandCollapse buttons under the outermost of up to 8 ancestors of its composer, because that area also holds other expandable buttons ("Add files and more", "Change permissions"). It is the one named `Select effort` (expanded) or `<model> <effort>` ending with a known effort label (collapsed). Several are refused (F5 on #915). The labels are used only to find this button, never to rank or list levels.
- **Eight setting actions, each checked by a fresh read (F1, F2).**
  - `expandSetting` acts only on a collapsed qualified button. `collapseSetting` acts only on an expanded Claude button and refuses Codex.
  - `invokeSelectModel` acts only on the open picker's one "Select model".
  - `focusMenuEntry` and `selectMenuOption` act only on the named qualified menu with the caller's entry count. `selectMenuOption` also needs the option to be the focused element, as `invokeCardButton` does. `invokeCurrentOption` acts only on the Codex model list's selected option.
  - `setSliderValue` acts only when the slider reads the caller's value and the target is one SmallChange away within the range.
  - `focusComposer` needs exactly one composer.
  
  Each action re-finds its target in the helper just before acting, and any difference is unknown, so a stale read in the bridge can never make it act twice or on another element. These actions act on elements, not on whatever has focus, so nothing can leak into the composer.
- **`tapInClient`, narrowed.** Up and Down are gone. Only Left, Right and Escape remain beside the profile key names, for Codex's single Escape and the Power fallback. The foreground is read again right before `SendInput`.
- **`claudeSettings(localId)`** reads only the record's `model` and `effort` keys.
- **Shared simulated picker model with lag.** The simulated desktop and the test fake share `src/sim/pickers.ts`. Its `lag` mode returns, for the read after each change, the state from before it once, so F1-style races are testable in unit tests and in the `knob-lagging-reads` scenario.

### Router flows

- **One flow at a time.** `SettingKnobs` keeps the queue rule from the first round: input not owned by the open flow waits, in a bounded queue, while the flow closes. A loss drops the queue, and a reload or loss closes the flow through it.
- **Gating reads wait for their condition (F1).** Every read that decides an action waits up to 400 ms for its condition before giving up: is the menu open, does the option have focus, is the button expanded, is the slider open, is Power focused, is nothing open before a flow starts. One stale read therefore only delays a flow; it can neither skip a close nor trigger a second action.
- **Claude model:** Expand, then focus the current model (the menu's own initial focus varies). Each detent focuses the next option, never "More models". A still click calls `Select` on the confirmed candidate, and readback uses the button plus the session record when the session in front is known. Then `focusComposer`, so Play still works.
- **Claude effort:** Expand, then `setSliderValue` one step from the value read. The range comes from the slider, so at an end the bridge sets nothing, logs `at-limit`, flashes once and drops the waiting detents (A1). Readback uses the button and the record.
- **Codex model:** Expand, Invoke "Select model", focus the current option; steps and pick as for Claude. Codex returns to its picker, the bridge closes it, and the closed button's name is matched to the longest option prefix: `applied`, `mismatch` for another option, `unverified` for none (as after "Default").
- **Codex effort:**
  - With chords, one chord per detent after the precheck (Codex in front and qualified, no card, nothing open), then a bounded wait for the picker button's name to change: `applied`, else `mismatch` (`unchanged`) with the waiting detents dropped. Codex gives no range here, so an end of range and an unbound chord look the same.
  - Without chords, Expand, focus Power by UI Automation, then Right or Left only after a fresh read shows Power focused, reading the level count from the announcement each time.
- **Closing.**
  - Claude: `Collapse` only when a read shows the button expanded, then composer focus.
  - Codex: a model list left without a pick gets `Invoke` on its current model first, which returns to the picker unchanged. On Codex 26.930.3930.0 (observed 2026-10-07, S906-4), `Select` on the current model does nothing and `Invoke` returns to the picker, which then reports no keyboard focus. That is why the single-Escape rule first moves focus into the picker. Escape is never sent from the list, because that is unqualified. A knob 1 pick of the model already in use also uses `Invoke`. Then exactly one Escape, only when a fresh read shows the picker holding focus. If it is open without focus, focus is first moved into it by UI Automation.
  - After the Escape comes a bounded wait for the button to read collapsed. An unchanged state means "closed, unverified", never a second Escape.
- **No Enter.** No knob flow presses Enter. A shared test assertion (`noStrayKeys`) checks every knob test:
  - no Enter, except Send's own;
  - every Escape, Right and Left went into Codex's open picker;
  - every chord went into Codex with nothing open;
  - one Escape per Codex close.

### Residual windows (F2)

Each window lies between a confirming read and the key, and is about one helper round trip: typically tens of milliseconds, at most the 2 s adapter call timeout. `tapInClient` re-reads the foreground right before `SendInput`, so a key never reaches another app.

- **Codex's closing Escape.** If the owner closes the picker or moves focus within the window, the Escape reaches whatever has focus in Codex, usually the composer, where Escape sends nothing. Whether an Escape in the composer interrupts a running Codex turn is not qualified, so the residual is that this Escape could stop a running turn. A card cannot be the target, because the knobs refuse while a card is open, unless one opens inside the window.
- **The owner's chords.** A card or picker that opens within the window would receive the chord.
- **Right and Left on Power (no chords).** If focus moves within the window, the arrow reaches the newly focused element in Codex.
- **UI Automation actions.** In the helper, the gap between the fresh read and the pattern call is a few milliseconds, and the call acts on the checked element itself.

No remaining key is Enter, so none of these windows can send a prompt.

### Profile

Unchanged from the first round:
- optional `model` and `effort` sections (`stepCounts` 6, `invert`, `model.clickStillMs` 250);
- the two Codex chords, both or neither, as a Ctrl, Alt or Win chord with exactly one other key and never Enter;
- `timing.menuTimeoutMs` 5000 and `colors.applied`;
- `schemaVersion` stays 1.

The step counts are the conservative card step constant until #745 measures knobs 1-3.

### Verification harness

Eight scenarios:
- `claude-model-knob`;
- `claude-effort-knob` (including the top of the range);
- `claude-effort-unsupported`;
- `codex-model-knob`;
- `codex-effort-chords`, which saves the chords in the run's profile;
- `codex-effort-knob`, the Power fallback;
- `knob-lagging-reads`;
- `knob-refusals`, with Play closing an open menu first.

Each checks that no prompt is sent and which keys each client received.

## Risks and residuals

- **The helper's operations have not run against the live clients.** The qualification used the coordinator's own pattern calls. Still to observe:
  - Codex's picker-button selector (identified by name since F5);
  - menus and the slider inside the window's tree;
  - the slider's SmallChange;
  - the announcement's element;
  - composer focus after a Collapse.
  
  Each failure makes the knob refuse or report `unverified`, never act. The native check records the shapes read-only, and #745's installed checks confirm them.
- **Codex chords at an end** read as `mismatch` (`unchanged`), as an unbound chord would.
- **Session in front.** The Claude record readback applies only when the router can tell the session in front. A session unknown to the router could make another look newest and give a false `mismatch`, never a false `applied`.
- **Step counts** are unmeasured until #745.
