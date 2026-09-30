## Context

See proposal.md for motivation. The sender (`apps/hub/src/moment-sender.ts`, #335) waits up to 2.5 s for the device's slot, then reads a fresh 1.1 snapshot and POSTs once, each call bounded at 2 s, so one call can take about 8.5 s in the worst case. The hub destroys any HTTP response still open 3 s after the request arrived. The dashboard reads each device every 5 s through its per-device queue and sends every control through the shared command lifecycle (`apps/dashboard/src/lifecycle.ts`), which watches only an accepted ticket and locks on an uncertain result.

The design covers ownership, timing, failure and recovery because the change adds a device command path. It adds no durable state, migration or new dependency.

## Goals / Non-Goals

**Goals:**
- One owner press sends at most one moment through the one sender and the controller's own queue.
- The route answers within the hub's response cap even when the sender cannot finish.
- The card's words say only what the receipt or snapshot says.

**Non-Goals:**
- Arbitration, rules, budgets, choreography, palettes, a moment log or an MCP tool (#295, #296, #297, #358, #400).
- Any change to the sender, the controller client or the contract package.

## Decisions

### The route bounds the sender call and answers `uncertain` when the bound expires
The route starts the sender once and races it against a bound measured from the request's arrival, 2.5 s, which leaves room under the 3 s cap for the response. If the sender finishes first, its result is the answer. If the bound expires first, the answer is `{kind: "uncertain", momentId, start: null}`, and the sender keeps running to its own result, which nobody resends. `uncertain` is exact: the hub does not know yet whether the POST left.

Alternatives: an asynchronous 202 with a result to poll needs a bounded result store, another route and its own expiry, which a one-person try does not need. Shortening the sender's waits would change #335's interface and its other caller (#358). Raising the hub's response cap would weaken a protection that applies to every route.

### Every sender outcome answers 200 with the typed result
The body is the sender's `MomentResult` (or the bound's `uncertain`), so `kind` distinguishes the outcomes and the dashboard maps them to words. Typed HTTP errors are kept for what the route itself refuses before any controller contact: authorization (401/403), an unknown alias (404) and an invalid body (400 `invalid-request`). An undeclared mood or a duration above the device limit is the sender's `not-sent` `unsupported-capability`, decided from the fresh snapshot with no command sent. A contract-range check at the route catches malformed input without a read.

### The dashboard's device read asks for 1.1
The page's one device read adds `?apiVersion=1.1`. The hub's negotiation returns the 1.0 snapshot for a 1.0 controller and remembers that per controller epoch, so a 1.0 device costs one extra read per epoch and then reads as before. A 1.1 snapshot contains every 1.0 field, plus `capabilities.moments`, `state.moment`, and pending or last-outcome entries that can name a moment, which the existing cards display as text. A separate read only for the card was rejected because it would double each poll for 1.1 devices. The LIFX read stays on its lighting route, which serves 1.0.

### The card reuses the shared lifecycle with two small extension points
`runCommand` gains an optional `interpret` for a response that is not a receipt, returning the result words and the ticket to watch, and `ResultOptions` gains an optional `describe` for a later terminal receipt of the watched ticket. The moment card supplies both from one mapping, so a queued receipt reads "Celebrate: Scheduled on wall." and a later `moment-blocked` receipt for the same ticket reads "Not played: wall is in Work." Existing consumers pass neither and are unchanged. `Wording` gains an optional sending line so the pending status names the mood without prefixing every result.

### The faster refresh lives in the card
The card knows whether it is visible (the component page is the current route) and whether a moment is current. It then re-reads through the same per-device refresh every second, until 5 s after it last saw a current moment. The refresh function is held in a ref so the interval is not reset by the dashboard's one-second clock renders.

### Mood names come only from this page's own sends
`state.moment.last` carries the moment ID and ending but no mood. The card records the mood of each moment ID this page sent, receipt or uncertain, in memory keyed by component, and forgets it when the dashboard unmounts. Any other last moment reads "Last moment: …".

### The fixture's wall uses the contract's reference writer
With `moments` enabled, the dashboard fixture's wall answers `apiVersion=1.1` reads with a 1.1 snapshot and admits 1.1 moment requests through the contract's `admit`. It runs the contract's `moment` reference operation as its writer on a live device clock, so Quiet, status cover, supersede, completion and missed starts follow the contract rather than a hand-written copy. Unversioned reads get the contract's downgraded 1.0 view. Knobs set a scheduled lead, stall the next delivery past its window, refuse one versioned read like a 1.0-only controller restart, and set the wall's mode.

## Risks / Trade-offs

- [A slow controller makes the route answer `uncertain` although the moment may play] → The card locks and the live line shows what the device reports after "Reload current values"; nothing is resent.
- [A controller that answers `invalid-request` to the versioned read costs one extra read per controller epoch] → That is #576's negotiation; later reads in the epoch send no version parameter.
- [A 1.1 snapshot's moment entries appear in the Details list as `moment`] → They are accurate evidence; no card filters them.
- [Fake clocks do not prove a device's timing] → Physical acceptance stays with codex-nanoleaf#158 and divoom-app-upgrade#92 and a separately authorized install.

## Migration Plan

Source only. The route and card appear after an authorized hub install and do nothing until a registered controller serves 1.1. Rollback is reinstalling the previous hub; there is no stored state to migrate.
