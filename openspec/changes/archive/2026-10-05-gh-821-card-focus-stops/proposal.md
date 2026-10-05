## Why

The installed live check of [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821) on 2026-10-05 used a Claude question card with three options. It found two faults in big-wheel card answers:

- **No choice was ever recorded.** The wheel logged `card-step` for buttons 1 to 3, but every still click was refused as `card-nothing-chosen`. Probing the open card directly with the installed helper showed the cause:
  - `focusCardButton(2)` replied that no button had focus;
  - 300 ms later, `cardButtons` reported button 2 focused.

  Claude applies focus asynchronously. The helper read focus back at once, so the router never saw its step land and never recorded the button as chosen.
- **The wheel stopped on the wrong buttons.** It walked all six actionable buttons, the same stops as Shift+Tab: a header button, the three options, the "Other" row and a footer button. The owner expects to move through the answers only, as Up and Down do inside the option list.

## What Changes

- **Bounded focus read-back.** After a focus request, `focusCardButton` reads keyboard focus back every 25 ms for at most 400 ms until it is on the requested button, then replies with the index it observed. The reply shape is unchanged. The router still records a choice only when the reply names the requested button.
- **Claude answer stops.** For Claude cards only:
  - when at least one actionable button carries the class token `text-left` (a question card's answer rows and its "Other" row), the wheel stops only on those buttons, in tree order;
  - otherwise, as on a permission card, every actionable button stays a stop.

  Codex is unchanged.
- **Docs.** The bridge README, UIA-NOTES and the qualification report record the live findings, the stop rule and the re-qualification note.

## Capabilities

### Modified Capabilities

- `chompi-bridge`: the card operations' stops and their focus read-back.
- `chompi-task-routing`: card answers step through the adapter's stops, which are a question card's answers.

## Impact

This change affects the bridge package only. The adapter interface and helper protocol keep their versions, because no signature or reply shape changes. Installation is a bridge reinstall on the trial host. The live check repeats on a Claude question card and a permission card.
