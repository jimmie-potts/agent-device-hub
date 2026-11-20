## Context

Rooms consumes the Presence Pro producer's projected apartment positions. Each
point has independently received axes and a reported hold status. Connected
silence can preserve a source point.

## Goals / Non-Goals

**Goals.** Make overlapping positions readable in the regular map. Preserve
source inspection in Sensors.

**Non-goals.** Identity, persistent target association, calibration changes,
commands, new telemetry, storage and history.

## Decisions

- Pair only the single usable point from each of two different connected sources.
  Require the same projected room and a midpoint that maps uniquely to that room.
  Use the existing calibrated coordinates and equal weights.
- Require a separation of at most 0.65 m. All four axis receipts must have arrived
  within 2.5 seconds and span at most 1.2 seconds. A known held point is ineligible.
  Local receipt times bound the display estimate. They are not measurement times.
- Recompute on feed changes and expire the estimate locally on a timer. Sensor
  evidence retains its existing last-report behavior and source filter. The UI
  does not store or publish combined estimates.
- Verify the selection and expiry as pure logic and run the actual Sensors
  transition through the existing disposable Rooms browser journey.

## Risks / Trade-offs

Nearby people or pets can still produce plausible overlap. The marker represents
an anonymous approximate position. A missing target or an unchanged receipt can
hide the combined estimate while source details remain available.
