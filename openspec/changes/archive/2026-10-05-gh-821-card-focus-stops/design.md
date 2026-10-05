## Context

Card answers (archived change `2026-10-05-gh-821-press-time-routing`) move focus with UI Automation `SetFocus` and record a wheel choice only when `focusCardButton` replies with the requested index. The helper read focus back immediately after `SetFocus`. That was qualified only from read-only structure probes, never against live focus changes.

## Decisions

- **Poll, don't sleep.** After `SetFocus`, the helper reads `FocusedElement` every 25 ms and compares it with the card's stops using `Automation.Compare`, which reads no text. It stops as soon as focus is on the requested stop, or after 400 ms on a monotonic `Stopwatch`. It replies with the last observed index, or -1.
  - 400 ms covers the observed 300 ms lag with margin, and stays well inside the 2 s adapter call timeout and the 4 s helper request timeout.
  - A fixed sleep would add latency to every step, even in Codex, which applies focus at once.
- **No router change for late focus.** If focus lands after the bound, the reply names no stop and the router records no choice. A click then presses nothing (`card-nothing-chosen`), and the next step reads focus again. Retrying `SetFocus`, or trusting a later read, could record a button the owner never reached.
- **Answer stops by class token.** In the probed three-option question card:
  - the option rows are `Button`s whose class list carries `text-left` (`... rounded-[5px] px-md py-md text-left ...`);
  - the "Other" row also carries it (`... text-body text-primary text-left ...`);
  - the header, footer and disabled submit buttons are `cds-reset group/btn ...` buttons without it.
  - Every button in the permission card is a `cds-reset group/btn` button without `text-left`.

  So the rule is:
  - a Claude card with at least one actionable `text-left` button stops only on those buttons, in tree order;
  - otherwise, every actionable button is a stop.

  An exact class-token match (`HasToken`) is used, and no text is read. The 64-button bound still applies to all `Button` elements before any filter, and indexes and counts refer to the stops.
- **Codex unchanged.** The probed escalation card's two actionable buttons are its answers already.

## Risks

- A Claude update can rename `text-left`. Then a question card falls back to every actionable button: the old, wider stops, but still safe. Re-qualification with a question card open checks the stop list, as UIA-NOTES records.
- A question card whose "Other" row is a free-text field still lists the "Other" row button. A press on it opens or focuses the field, as a click on that row would; it submits nothing.

## Acceptance examples

| Example | Test |
| --- | --- |
| Focus applied within the poll is chosen and a still click presses it; focus applied after the bound records no choice and the click presses nothing | `routing-router.test.mjs` |
| The helper polls focus after its single `SetFocus` with the 25 ms and 400 ms bounds, compares only, and keeps its reply shape | `windows-uia-helper.test.mjs` |
| Claude cards use the `text-left` stop rule with an all-buttons fallback; Codex does not | `windows-uia-helper.test.mjs` |
| Live: a Claude question card steps through its answers only, and a still click presses the one reached; a permission card steps through all its answers | Installed check (owner) |
