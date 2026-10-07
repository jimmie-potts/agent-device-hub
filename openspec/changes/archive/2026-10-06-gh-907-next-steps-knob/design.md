## Context

Knobs 1 and 2 set the model and effort through `SettingKnobs` (#906): one flow at a time behind the router's queue, UI Automation actions that re-read their target in the helper, gating reads that wait up to 400 ms for a lagging view, and a shared `noStrayKeys` test assertion. Knob 3 was inert.

The 2026-10-06 qualification on [#907](https://github.com/jimmie-potts/agent-device-hub/issues/907) (Claude Desktop 2.19675.0.0) recorded:

- **The band:** after a turn in a session that loads the `next-steps` mod, a `Group` directly above the composer's group holds a `Text` `next:`, one `Button` per suggestion (named with its label) and a `Button` `dismiss`. Sending a message hides it.
- **Focus:** a suggestion button is keyboard-focusable; `SetFocus` gave it keyboard focus and the owner saw it highlighted; focus returned to the `Prompt` editor and the caret came back.
- **Ghost text:** Claude's prompt suggestion is not exposed to UI Automation: the empty `Prompt` editor's Value and Text read one line break. A Right arrow accepts it without sending; Tab also does, but can move focus out of the composer when there is none.
- **Owner decision:** a knob 3 click invokes the suggestion knob 3 highlighted; otherwise it accepts the ghost text with a Right arrow, only with Claude's composer confirmed focused and empty. Either way it fills a draft only, and Play sends.

## Goals / Non-Goals

**Goals:** knob 3 highlights and fills Claude's suggestions and accepts its ghost text, keystroke-free except the one Right arrow; it never sends; it refuses everything outside the qualified state; suggestion text never leaves the helper.

**Non-Goals:**
- Codex next steps (#908, now on the visual-layer epic).
- Showing suggestion text on PROMPTI or a screen (#747, #748).
- A mod that reports whether ghost text is showing, which needs the owner's approval to change their Claude setup.
- The issue's digit-key fallback (typing 1-3 into the empty composer, which the mod documents) is dropped (S907-1 on #943). The qualification showed the suggestion buttons take keyboard focus, and the owner-accepted click rule is: invoke the highlighted suggestion, else one Right arrow for the ghost text. The bridge types no digits.

## Decisions

### Adapter interface version 6

Version 5 shipped with #906 (PR #915), so the band operations bump the interface to 6.

- **`suggestionState('claude')`** returns `{ count, focused, composer: { focused, empty } }`. The helper finds Claude's one `ProseMirror` composer and the chain of its 8 nearest ancestors. It reads the window's `Text` elements named `next:` (more than 32 fail) and, for each, takes the parent `Group` when it hangs under one of those ancestors at most 3 `Group`s below the ancestor's child that is not the composer's own branch, and directly holds exactly one `Text` `next:` and exactly one `Button` `dismiss`. The other direct buttons, in tree order, are the suggestions: 1-8, each enabled, keyboard-focusable and invokable, or the read fails (`suggestion-band-unqualified`). The band at the lowest ancestor counts; two there fail (`suggestion-band-ambiguous`).
  - **Fix round 1 on #943.** The first version checked only the direct children of groups beside the composer's ancestors. The native check on 2026-10-07 read no band while one showed: on Claude 2.19675.0.0 the band's group sits two `Group`s below the branch beside the composer's group (common ancestor at depth 14; band branch 15 -> 16 -> 17; composer group at 15). The locator now starts from the `next:` texts and allows up to 3 levels below that branch, which keeps the direct-sibling shape too.
  - **Shared reference.** `src/sim/band-tree.ts` implements the same rule over a synthetic tree in the live layout, with the same bounds (a static test holds the constants equal). The simulated desktop and the test fake find the band through it, so a locator that missed the observed nesting fails the contract and scenario tests.
- **Names and values stay in the helper.** Names are compared only to find `next:` and `dismiss`; suggestion labels are never returned. The composer's `ValuePattern` Value is compared only with `""`, `"\n"` and `"\r\n"`.
- **Empty composer:** no text, or only one trailing line break, because Claude's empty composer read as one `\n` (length 1). Whitespace the owner typed is a draft.
- **`focusSuggestion(index, count)`** and **`invokeSuggestion(index, count)`** re-find the band and refuse when it is gone (`band-absent`), has another count (`band-changed`) or the index is invalid. Focus is read back every 25 ms for at most 400 ms. `invokeSuggestion` checks, in the same helper call and just before `Invoke`, that the suggestion is the focused element and the composer is empty, and answers `false` otherwise.
- **Codex** answers `invalid-client` in every adapter; Codex has no band (#908).
- **Shared simulated band with lag.** `src/sim/suggestions.ts` models the band, focus, the fill, the ghost text and a turn hiding them, over the composer of the simulated desktop or the test fake, with the `lag` mode #906 introduced.

### Router flow

- **Knob 3 joins `SettingKnobs`** as a third knob (`next`), so it shares the one worker, flow, timeout, close path and queue integration: a knob 3 flow is closed before another control acts, and a knob 1 or 2 flow before knob 3 acts.
- **Turn.** The first detent runs the shared precheck (Claude in front, qualified, no card, model and effort controls readable and closed), refuses Codex (`codex-no-next-steps`), waits up to 400 ms for a band with an empty composer, then focuses the first suggestion. The first suggestion is the mod's top suggestion, which is also the ghost text, so the first detent starts there whatever the direction. Further detents move one suggestion within the band's count, which must be unchanged.
- **Highlighted click.** After the stillness check, a read that waits up to 400 ms confirms the same count, the candidate focused and the composer empty; `invokeSuggestion`; `focusComposer`; a readback within `verifyTimeoutMs` that the composer holds a draft (`filled`, else `unverified`). A failed confirmation ends the flow with composer focus and names the reason (`focus-moved`, `band-changed`, `band-gone`, `draft-present`, `suggestion-changed`).
- **Ghost click.** With no knob 3 flow open, the click runs the precheck, waits up to 400 ms for the composer to read focused and empty, and sends one Right arrow through `tapInClient`, which re-reads the foreground right before `SendInput`. The readback reports `filled` or `unverified` (`composer-empty`); the bridge cannot know whether ghost text was showing.
- **A turn needs an empty composer** as well as the click, so a highlight never leads to a click that must refuse.
- **Closing always focuses the composer.** The bridge moved focus off the composer, and Play depends on getting it back. `focusComposer` is idempotent when the composer already has focus, and refuses when Claude is not in front. The cost: if the owner moves focus elsewhere in Claude during the 5 s highlight, the close moves it back.

### Residual windows

- **The Right arrow:** between the confirming read and `SendInput` (about one helper round trip, at most the 2 s adapter timeout), the owner can type or move focus in Claude. The arrow then moves the caret in the text or moves within the focused control. It cannot send, and no card was open at the read.
- **`Invoke`:** focus and the empty composer are checked in the same helper call, a few milliseconds before `Invoke`, which acts on the button itself.

## Risks / Trade-offs

- **The band's nesting is observed once** (2026-10-07, two `Group`s below the branch beside the composer's group). A client update that moves it beyond the bound makes knob 3 turns refuse with `no-suggestions`; the ghost click still works, and the native check's `level` shows where the band was found.
- **`Invoke` filling the composer** matches pressing the button (the mod's `$.prompt.fill`), but the helper's `Invoke` was not run live. A failure reads `unverified`, never sends.
- **Ghost presence is unknown**, so a ghost click with no ghost text shows the `unknown` color, not an error. A presence mod is a later owner choice.
- **Two refusals overlap** for the ghost case and a band read failure: an unqualified or ambiguous band makes the whole read unknown, so the ghost click refuses too (`suggestions-unknown`). This fails closed.
