## Why

Installed check 4 of [#821](https://github.com/jimmie-potts/agent-device-hub/issues/821) on 2026-10-05, with installed d1ea6a8, found the big wheel inert on a visible Codex escalation card. The bridge logged `card-unknown` with `codex-card-unestablished`. A read of the card gave no composer, one selected sidebar row and no card, and no element in the window had keyboard focus. The Codex container rule started from the focused card button, but Codex does not reliably give its card focus, and the owner may click elsewhere.

## What Changes

- A Codex card is found by structure, independent of focus. All of these must hold:
  - no `ProseMirror` composer;
  - exactly one selected sidebar row;
  - exactly one on-screen `Group` that directly holds at least one `Text` element and at least two actionable buttons. That group is the card.
- The stops are the group's actionable direct-child buttons, Deny then approve, and the focused index is -1 when none has focus.
- The helper reports `cardGroups` and `focusElsewhere`, and the adapter decides:
  - zero candidates is `codex-card-unestablished`;
  - several candidates is `codex-card-ambiguous`;
  - a focused button outside the group is `codex-card-focus-elsewhere`.
- The search is bounded: one cached list of Group elements, unknown above 512 (`card-too-many-groups`), plus one cached child read per on-screen candidate.
- With no initial focus, the first clockwise step focuses Deny and a counter-clockwise step focuses approve. The clamp rule applies once a stop is focused.
- README, UIA-NOTES and the qualification report record the rule and the live finding.

## Capabilities

### Modified Capabilities

- `chompi-bridge`: the Codex card container rule.
- `chompi-task-routing`: a scenario for a Codex card without focus.

## Impact

This change affects the bridge package only. The adapter interface keeps version 3: the reply gains two Codex fields that the adapter alone reads. Installation is a bridge reinstall on the trial host, and installed check 4 repeats.
