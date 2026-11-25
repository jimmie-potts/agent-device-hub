# Design

## Context

React unmounts the root on an error no boundary catches, in render, lifecycle or a passive effect. Errors in event handlers and async work never reach a boundary and leave the page mounted; they keep their current behavior.

## Decisions

- **Placement.** The boundary sits where module and card content is drawn: around each Home card's content inside its grid cell, around each device card on the component route, and around the module page on its route. The grid cell is outside the boundary, so a failed card keeps its place and size. The shell (rail, hero, palettes, menus, workspaces) stays outside: a fault there is a shell fault, and its failure state would need its own design.
- **Failed face.** The card's name, "`<name>` failed to show. Its controls are unavailable." and one Retry. Retry bumps a key, so the card mounts afresh; it sends no request. A change of identity resets the boundary. A card that throws after Retry is contained again, and nothing retries by itself, so there is no render loop.
- **Record.** `recordCardFault` writes `dashboard.card.failed` through `recordLog`, whose level the SDK table owns (ERROR, an internal fault), with `bunny.card`, `bunny.code: internal` and `error.type` from `errorType`. No message, stack or cause, and no name or label (ADR 0011, ADR 0012 "Safe errors"). The diagnostic contract's browser relay is not adopted, so the records stay in a bounded in-page log of 64. `bunny.card` is not a catalog attribute; registering it belongs to a relay's adoption.
- **Visibility to tests.** The boundary passes the error to `reportError`, so the page reports it as it reported the uncaught error before and journeys that watch page errors still fail. The failed face carries `data-card-failed` and `data-error-type`, which the harness checks at each `feed()` and `copiesSynced()`.

## Testing

A test build of the dashboard replaces three imports of the shell with stand-ins that throw on request, so no product hook exists for the fault.

## Risks

A fault in the shell itself still unmounts the page. The in-page record is lost with the page until a relay exists.
