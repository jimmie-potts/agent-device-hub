# Contain a card's rendering error to that card

## Why

[Hub #2139](https://github.com/jimmie-potts/agent-device-hub/issues/2139): the runtime dashboard has no React error boundary, so an error thrown while one card renders, or from one of its effects, unmounts the whole page. The owner decided on 2026-11-25 that such an error stays in its own card.

## What changes

- One boundary wraps each Home card, each device card on a component page, the module page on its route, the Settings, Companions, Habitat, Timeline, Automation and Connections pages, the device directory, the rail's conversations and the art backdrop source. A failed card or page says that it failed and offers one Retry that draws it again; it shows no stale content and no control, and sends nothing. A part that draws nothing shows nothing when it fails.
- Each failure forms one record through the SDK's `recordLog` as `dashboard.card.failed`, at the code table's ERROR level, with the part's identity and the error's type. The record stays in a bounded in-page log and is delivered nowhere yet, because the browser has no diagnostic route to the runtime; delivery is a follow-up (#2159).
- The browser journeys' harness fails a health check on a part in the failed state that the journey did not expect, and fails the run at the world's close on a part that failed after the journey's last check, naming it.

## Capabilities

### Modified capabilities

- `runtime-dashboard` gains card error containment.

## Impact

`apps/runtime/dashboard` and its browser tests. The SDK's code table gains one event, and its browser entry exports `errorType`, `levelOf`, `recordLog` and the logger types. No message format, error body, API, storage or module contract changes. The legacy `apps/dashboard` is unchanged.
