## Why

The owner accepted the Clear Home prototype (epic [#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927), reference `docs/design-references/home-clear/`). Story [#1933](https://github.com/jimmie-potts/agent-device-hub/issues/1933) lets a light or a plug be dragged by its handle onto another to group them, with panels that fuse as they meet. Owner decision 6: lights and plugs can be grouped, and a group has one control that switches every member on or off, each member receiving its own existing command.

## What Changes

- A drag handle on each light, plug and group panel on Home starts a pointer drag (mouse, pen, touch). The card follows the pointer, the glass layer joins it to the panels it nears, and the light, plug or group card under it lights up as the target. Dropping there groups the two and saves; dropping anywhere else returns the card. This replaces the light card's "Drag to group" on Home.
- A group panel shows its members with their switches, one All on or All off control and Ungroup. All on or All off sends each member its own existing power command with that member's guards and names members that refused, were not sent or did not answer.
- The one lighting-layout group record extends to plugs: `lighting-layout/2.1` adds an optional `plugs: [{device, owner}]` on a Home group. The core reconciles Home placement in the same transaction: a new group card takes the Wide shape, and ungrouping restores each member, a plug under its own device card, as a Small square.
- The "Group with" selector stays the keyboard path and offers plugs too, including from a plug's own options.

## Capabilities

### Modified Capabilities

- `runtime-lighting`: grouping changes placement only, except the group's All on or All off; Home groups may hold plugs; the drag handle and the group panel.
- `shared-event-contract`: `lighting-layout/2.1` and its validation.
- `home-layout`: group cards that hold a plug offer Wide; grouping and ungrouping reconcile shapes.
- `runtime-dashboard`: the glass layer lights up a drop target.

## Impact

`packages/event-contracts` (a 2.1 schema, checks, README), `apps/runtime/src/core/home-layout.ts` and `lighting-layout.ts`, and in `apps/runtime/dashboard/src` the lighting model, a fuse provider and group panel, light, plug and Home cards, the Home catalog and the glass scene, layer, renderer and shader. No new command family, sync family, route or MCP tool; `lighting-layout-set/2.0` accepts the 2.1 layout. The Content Security Policy is unchanged. Installation is tracked in [#1935](https://github.com/jimmie-potts/agent-device-hub/issues/1935).
