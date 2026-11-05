## Context

ADR 0012 lets a vendor adapter that must poll publish what it observes. The module has one consumer, the planned `modules/art`, and one operator location. The location must stop at the weather service.

## Goals / Non-Goals

**Goals:** a truthful synced record, no location on any surface, and one signal per real change.

**Non-Goals:** other providers or fallback, several locations, a dashboard page, severe-weather notification and station measurements.

## Decisions

- **Reduce vendor text at the client.** Every field is a number, a time or a closed-vocabulary value. Free text such as `areaDesc`, `headline`, `relativeLocation` and `shortForecast` stops in `client.ts`. Alert `event` comes from a closed list of national names, and an unlisted name is published as the generic `Weather Alert`, which also keeps one unexpected name from losing all the weather. This closes both the location leak and prompt injection from a vendor response. The alternative, publishing `shortForecast`, gains nuance that art does not need.
- **No facts when unavailable.** An `unavailable` record has no weather fields, so a consumer cannot state a fact from it by accident. A stale `available` record yields no words through `promptWords`, which covers a consumer holding a copy across a suspended host.
- **`current` is the hourly forecast.** The issue names the points, hourly and alerts reads. The record states that `current` is a forecast, not a measurement.
- **A failed alert read fails the whole read.** An empty list would claim no alerts exist.
- **Baseline is the last signalled conditions and persists.** Comparing with the last signal rather than the last poll means slow drift signals once and hovering does not. Persistence means a restart is not a change.
- **Keep no weather in the store.** A restart publishes `starting`, then reads again. A kept forecast would only be republished stale.
- **No device simulation.** The module reaches no device or local file, so it fits the container's existing rule. `simulate` answers from synthetic responses.

## Risks / Trade-offs

- The module has not read the real service: its parsing rests on the documented response shape and synthetic responses. #687 owns the real check, and a shape mismatch would appear as truthful `malformed` state.
- The event list is written from the service's published types, not read from it. A name it misses is less specific, never wrong or leaked.
- Condition flapping between `clear` and `clouds` can signal repeatedly. Art's own hourly and spend limits bound the effect, so the module adds no separate limit.

## Migration Plan

New tables only, created when missing. A runtime without the section reports the ordinary absent state. Rollback leaves an unused file.

## Open Questions

None. The location comes from the owner's private configuration at #687.
