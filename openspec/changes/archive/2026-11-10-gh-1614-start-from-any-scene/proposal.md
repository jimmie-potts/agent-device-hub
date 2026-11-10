## Why

A live Music session on the Lines starts only over a scene saved on the light ([#1614](https://github.com/jimmie-potts/agent-device-hub/issues/1614), phase 1a of #1617, epic #720). A colour picked in the app, an unsaved scene, an effect or an earlier session's frames are refused `invalid-state`. The #725 trial of 2026-11-10 hit this, and only a direct read of the light could show which selection refused the Start.

Owner decisions, 2026-11-10: an unnamed base lets the Start go ahead, and its Stop, alert or source-loss ending leaves the last frame and reports restoration `none`, with no scene guessed. A plain colour is captured at the Start and restored at the ending. Bounded moments keep the named-scene rule.

## What Changes

- **Start from any selection.** A Start on a light that is on, in Free, with a readable selection and brightness is admitted over whatever it shows. The base is a saved scene, a plain colour (`*Solid*` with a hue and saturation or colour temperature in `/state`), or an unnamed selection that cannot be selected again.
- **Endings.** Stop, an alert and source loss put a saved scene back as today, and a colour back by writing its hue and saturation or temperature after the brightness, under the same guards. An unnamed base gets no read or write at the ending: the light keeps the last frame and the ending reports `none`. Manual, device and restart endings are unchanged.
- **Selection in the light's record.** The `nanoleaf-wall` record gains `selection`: whether the last read selection is a scene saved on the light (by its opaque scene ID), the light's own placeholder name such as `*Solid*`, what an ending over it would put back, and when it was read. It also gains `musicBase`: what the latest session's ending puts back. Both come from reads a Start and a playing session already make, with no extra request. No scene name is published.
- **Refusals name the selection.** A Start refused because the light is off or unreadable says what the light reported, by the same opaque words.
- **Audio card.** Before Start, the Music lighting card explains what an ending would put back from the last read selection. During a session and after its ending, it explains what that session puts back, or why nothing was.
- **Unchanged:** the single device writer, the device queue, the manual-takeover rule (#1598), the streaming entry (#1599), bounded moments (#1030, #1259), the core's session contract and the `music-lighting-device` record.

## Capabilities

### Modified Capabilities
- `nanoleaf-module`: Start admission over any readable selection, base restoration by kind, and the selection in the light's record.
- `runtime-dashboard`: the Audio Music lighting card explains what an ending puts back.

## Impact

- `modules/nanoleaf`: the Start's base read, session restoration, the selection store and the `nanoleaf-wall` record and schema, the simulated controller's colour, their tests and the README.
- `apps/runtime/dashboard`: the Music lighting card and model, their unit test and browser journey.
- A new private `nanoleaf_selections` table, created if missing; an older module ignores it. No contract package, core, migration or installation change. #725's installed check (#1614 AC4) qualifies the behaviour on the Lines.
