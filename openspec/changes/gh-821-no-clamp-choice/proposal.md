## Why

PR #825's second fix round let a wheel step that was clamped at the first or last stop choose the button that kept focus, so one clockwise turn chose a Codex card's approve button when it opened focused, and a still click approved. The owner decided on [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821) (issuecomment-6003766052) that approval should come from a click, not a turn: a press needs a step that visibly moved the focus onto a stop, then a still click.

## What Changes

- A step that cannot move the focus, because focus is already at the first or last stop, logs `card-step` as before but makes no adapter call and records no choice. Any earlier choice from a real move stays.
- A choice is still recorded only when the helper's read-back confirms the requested stop after a real move.
- On a card that opens with focus on its last stop, the owner turns away and back before a still click.
- The README card rules, UIA-NOTES and the qualification report drop the one-turn approve.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: the card answer requirement's choice rule, and the clamp scenario is replaced by "A clamped step chooses nothing". OpenSpec cannot drop a scenario from a modified requirement, so "Card answers with the big wheel" is removed and re-added whole as "Big-wheel card answers". Every other rule and scenario is unchanged.

## Impact

This changes the bridge routing core only, with no adapter or helper change. Installation is a bridge reinstall on the trial host. Installed check 3 for Codex cards now turns away and back on a card that opens with approve focused.
