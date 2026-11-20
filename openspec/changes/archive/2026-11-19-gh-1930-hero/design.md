## Context

Home (`home-layout.tsx`) draws the saved arrangement on the unit grid over the glass layer of #1929. The Hub mode card (`hub-mode.tsx` adapter, `hub-mode-card.tsx` presentation) and the Art card (`home-art-slot.tsx`, the art module's `ArtWidget`, the pin, dismiss and format controls in `home-layout.tsx`) were placements in that arrangement. The art backdrop source (#1928) publishes presentation evidence once the layer reports the rendition drawn, so the forecast notice and the art theme no longer need the Art card.

## Goals / Non-Goals

**Goals:** the reference's hero; the same mode command, states and protections as the card; truthful chips; the Art card's effects behind chips; keyboard use; no frames at rest; a working Quiet fallback.

**Non-Goals:** the reference's hint line and its Inbox and All lights off chips; light and plug panels (#1931); a placeable hero.

## Decisions

- **The adapter stays, the face changes.** `HubMode` keeps its logic and renders `HubModeHero` (renamed from `hub-mode-card.tsx`), which takes the chips as children. The command, guards, Check Inbox and exceptions are unchanged.
- **Hero placements in the arrangement.** `heroPlacement()` marks `hub-mode` and `art`. The catalog omits them, so the grid, picker and built-in layout do too; the unknown-card report and the save filter skip them, so saved placements stay as they are. The art placement keeps holding pin, format and dismissal, which the hero's chips change through the existing revision-guarded save. Home passes the chips to the hero through a `renderHero` prop, because they need the layout's save.
- **Pin and Unpin are kept as they were.** They flip the saved pin flag exactly as the Art card did. With art as the backdrop the flag changes nothing drawn on Home; it is kept so the owner's decision is honored and saved arrangements stay meaningful to an older dashboard.
- **Dismissed art leaves Home.** The art on Clear Home is the backdrop, so a dismissed art placement hands the layer no backdrop: the Quiet glass wash is drawn, the presentation evidence goes idle and the forecast chip clears. Restore brings it back.
- **The thumb is not a panel.** `data-glass-thumb` marks the selected segment; the scene reads its box; `glass-thumb.ts` moves a lead and a lag capsule along x at the reference's 30% and 12% per frame converted to per-second rates (`-ln(1 - f) × 60`), snapping within 0.3 px; y, width and height follow at once, as in the reference. The renderer passes two `vec4` uniforms; the shader joins them with `k = 16` and shades them with the panel glass, slightly brighter. Reduced motion jumps. The layer schedules frames only while the thumb travels.
- **A segmented control, not a radio group.** Selecting sends a device-affecting command, so arrow keys move focus only and Enter or Space selects; the segments keep their toggle-button names and states.
- **The art module owns the forecast words.** `PresentedArtNotice` reads the combined presentation evidence and the notice through the existing context and states it in the widget's words, as a link to Automation so it takes focus. The shell only places it.
- **Chips from records already held.** `home-hero.ts` counts observed power: a stale copy, an unavailable device or unobserved power is unknown; a plug observation older than the Wemo card's 15 seconds is unknown too.

## Risks / Trade-offs

- [More veils] → the hero adds three veil marks (text, switch, chips) within the layer's 12.
- [Parallel #1931 edits Home] → the hero touches the layout's art paths and adds a slot above the grid; it leaves light and plug cards alone.
- [Pin has no visible effect] → recorded for the coordinator; removing it would be a separate owner decision.

## Migration Plan

None. Saved arrangements are read as they are; nothing is rewritten.

## Open Questions

None.
