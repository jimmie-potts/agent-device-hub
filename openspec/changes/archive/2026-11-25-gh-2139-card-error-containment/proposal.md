# Contain a card's rendering error to that card

## Why

[Hub #2139](https://github.com/jimmie-potts/agent-device-hub/issues/2139): the runtime dashboard has no React error boundary, so an error thrown while one card renders, or from one of its effects, unmounts the whole page. The owner decided on 2026-11-25 that such an error stays in its own card.

## What changes

- One boundary wraps each Home card, each device card on a component page and the module page on its route. A failed card says that it failed and offers one Retry that mounts it again; it shows no stale content and no control, and sends nothing.
- Each failure is recorded once through the SDK's `recordLog` as `dashboard.card.failed`, at the code table's ERROR level, with the card's identity and the error's type. The record stays in a bounded in-page log, because the browser has no diagnostic route to the runtime.
- The browser journeys' harness fails a health check on a card in the failed state that the journey did not expect, and names it.

## Capabilities

### Modified capabilities

- `runtime-dashboard` gains card error containment.

## Impact

`apps/runtime/dashboard` and its browser tests. The SDK's code table gains one event, and its browser entry exports `errorType`, `levelOf`, `recordLog` and the logger types. No message format, error body, API, storage or module contract changes. The legacy `apps/dashboard` is unchanged.
