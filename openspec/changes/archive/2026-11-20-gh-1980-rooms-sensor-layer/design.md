## Context

Rooms already projects approximate anonymous targets into the apartment map.
Its existing WebGL camera provides the coordinates for drawing and displaying
floor overlays. The two footprints are private display annotations.

## Goals / Non-Goals

**Goals:** Show two named zones, source filtering and sensor details from one
optional layer. Keep editing on the overhead map.

**Non-Goals:** Shared zone authoring across clients, device-native zone changes,
target association, automated controls and activity history.

## Decisions

- Keep temporary layer visibility and the selected sensor in the Rooms view.
  Treat each zone shape as private browser map configuration, keyed to the
  prepared plan. The core model and observations remain the source of geometry
  and device evidence. This requires no new API or storage migration.
- Draw rectangles with two floor selections in the overhead camera. The renderer
  maps the clicks into scene XZ meters using its own camera. Save explicitly and
  verify the rectangle fits the owning room before writing it. An invalid edit
  or interrupted draw leaves the saved footprint available.
- Display the shapes in both camera modes. A zone may show a tracked point from
  the selected sources, no tracked point, or position unavailable. A disconnected
  source cannot contribute a current point. Room occupancy comes from the
  existing Presence Pro reports.
- A failed browser write leaves the previous zones in effect and shows a retryable
  error in the editor. Read and validate saved footprints again on reload.

## Risks / Trade-offs

Rounded target coordinates can flicker at an edge and silent tracked slots can
lose their point. The layer reports the current observed geometry and offers
source details on demand. Each browser has its own zone footprints.
