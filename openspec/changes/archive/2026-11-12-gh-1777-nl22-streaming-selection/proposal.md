## Why

On the first run on the real NL22 Light Panels ([#1777](https://github.com/jimmie-potts/agent-device-hub/issues/1777), 2026-11-12, installed core `eebb5923`), every live Music session ended about a second after it started. While it streams version 1, the NL22 reports its selection as `*Dynamic*`, not `*ExtControl*` as the Lines do. The module read that as a newer manual choice, so it ended the session `manual`. That ending wrote nothing, which was the safe failure. [#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272) (PR #1652) had listed the NL22's streaming selection as assumed. This change corrects it under epic #720 and delivery handoff #1617.

## What Changes

- **Streaming selection by kind.** Each light's stream protocol (`stream.ts`) names the selection the light reports while it streams: `*ExtControl*` on the Lines and `*Dynamic*` on the NL22. The once-a-second playing check and the restoration guard both read that value as "the stream still shows". The Lines' value, requests, bytes and port do not change.
- **Manual change on the Panels.** A saved scene, a colour or an unsaved static selection picked on the NL22 during a session still ends it `manual` with nothing written over it. Each shows as a scene name, `*Solid*` or `*Static*`.
- **Stated limit.** On the NL22, anything else that reports `*Dynamic*`, with brightness and power unchanged, is not seen. Examples are an unsaved dynamic effect from the app, a temporary display played by the app or an integration, and another external-control client streaming to the Panels. No documented read tells these apart from the stream without a write. The session plays on, and if the light still applies its frames, they paint over the choice. A later Stop, alert or source loss restores the base over it. The README, the specs and the Audio card say so. The owner chooses among the options in `design.md` D2.
- **Colour-state diagnostic.** The `nanoleaf-wall` record's `selection` also shows the colour mode and whole hue, saturation and colour temperature of the `/state` read already made beside the selection read. No request is added and no session decision uses it. They are stored in a new `nanoleaf_selection_colors` table, which an older module ignores.
- **Leftover stream.** At the next Start, a leftover NL22 stream reads as an unnamed `*Dynamic*` base with nothing to restore, as #1614 already classifies `*Dynamic*`. The record's placeholder is `*Dynamic*`.
- **Simulated controllers.** The simulated Panels report `*Dynamic*` while they stream. Datagrams apply only while the controller is streaming, which every app choice ends. New app actions pick a colour or an unsaved static or dynamic effect, as the Nanoleaf app would.
- **Audio card.** The `*Dynamic*` base text also names streamed frames on the Light Panels, and the manual-change text states the Panels' limit.
- **Unchanged:** the Lines' session behaviour; the device requests and writes either light's session makes; the event families and error shapes; every record field except the diagnostic's optional additions; prepared timelines (#1273); the capture feed and visualizer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-module`: live sessions check each light's own streaming selection, the Panels' unseen-`*Dynamic*` limit is stated, and the record's selection carries the colour-state diagnostic.
- `runtime-dashboard`: the Audio Music lighting card states the Panels' limit and what `*Dynamic*` may be on them.

## Impact

- `modules/nanoleaf`: `stream.ts` (the per-kind streaming selection), `music-session.ts` (uses it and keeps the check's colour state), `music-base.ts` (`colorStateOf`), `music-store.ts` (the colour table), `module/runtime.ts` (keeps the Start read's colour state), `module/views.ts` and `module/schemas.ts` (the optional record fields), the simulated controller and its app actions, and the stream, session and module tests and README.
- `apps/runtime/dashboard`: `music-lighting-model.ts` wording, its unit test, and one assertion and wait in `music-lighting.browser.ts`.
- No contract package, core, migration, device request, device write or installation change. The only store change is the additive colour table. The installed NL22 check under #1777 and #725 needs owner-approved terms.
