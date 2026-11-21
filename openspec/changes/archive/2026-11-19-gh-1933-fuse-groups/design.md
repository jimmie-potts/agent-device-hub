## Context

The storage design and its failure and recovery notes were posted on the issue before code and accepted by the coordinator: [design note](https://github.com/jimmie-potts/agent-device-hub/issues/1933#issuecomment-7026499571) and [consumer audit](https://github.com/jimmie-potts/agent-device-hub/issues/1933#issuecomment-7026526843). This file keeps the decisions that the code relies on.

## Decisions

- **One group record.** A group that holds a plug lives in the existing `lighting-layout` record. `devices` keeps every member, lights and plugs alike, so uniqueness, overlap, the 2 to 64 bound and the Home checks are unchanged. The optional `plugs: [{device, owner}]` names the plug members and their owning module, which the core needs to name a plug's own Home card (`device:<owner>:<id>`). Only Home groups hold plugs.
- **Version 2.1, additive.** The core publishes `lighting-layout/2.1`; 2.0 stays registered and unchanged. `lighting-layout-set/2.0` references the 2.1 layout (the additive optional-field convention of #682 and #1672). Existing rows are valid 2.1; no migration.
- **No lighting command reaches a plug.** The only command builder for a lighting card, `prepareLighting`, refuses the whole card when a member is not a light, so a release that does not know `plugs` sends nothing to such a group. This release splits members by `plugs`: lights through `prepareLighting`, plugs through the Wemo card's guards and `deviceAction` `power-set` (`memberPower`). A group that holds a plug is always the group panel, never a light card.
- **Per-member All on or All off.** The group's one new behavior: each member gets its own guarded command; a member a guard blocks is not sent and says why, and the others still switch. Lights-only groups keep the shared all-or-nothing controls of the light card in the shapes that show it.
- **Placement in the core's transaction.** `reconcileLighting` maps a plug member to its device card. A new group card takes the Wide shape at its first member's place (the Clear group panel spans two units); ungrouping restores each member as a Small square. A refused or failed save changes neither record.
- **Drag on the page, glass from the boxes.** The handle captures the pointer; the Home card moves by a transform, which the glass layer reads as the panel's box, so the existing smooth-min join fuses it with its neighbors. The target is marked `data-glass-target`; the layer eases its light on a time base (160 ms, as in the reference) through two uniforms, `uTarget` and `uTargetGlow`, so no texel column is taken from #1931 or #1932. A card that does not group returns over 340 ms by frames that set its transform. Quiet glass shows the target with an outline.
- **Keyboard path.** The handle is not in the tab order; "Group with" in each card's options, a plug's included, offers every other light, group and plug on Home.

## Risks

- An older release on a store with plug groups refuses every lighting save until those groups are ungrouped in this release or this release is reinstalled (fix forward).
- A plug's state in the group panel uses its observation age at render time; the guard is evaluated again at send time.
