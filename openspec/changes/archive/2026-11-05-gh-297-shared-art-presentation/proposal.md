## Why

[The first-release slice of #297](https://github.com/jimmie-potts/agent-device-hub/issues/297) needs one saved idea to reach the browser, Pixoo and Tidbyt without generating another image. The existing sender cannot select different compositions and durations for each surface or distinguish completed preparation from admission.

## What Changes

- Add core-only saved-art preparation and browser selection to `art-auto/2.1`, preserving `art-auto/2.0`. A preparation outcome confirms staging; a browser outcome confirms the selected reference was committed, not that pixels were displayed.
- Add selected browser composition metadata in `art/2.1`, preserving `art/2.0`. Retain selected art through catalog pruning and let the widget acquire and decode that exact existing composition.
- Extend the existing core automation owner with per-device plans using current configured identities, affirmative fresh `moments.art` capabilities, one best-effort start and independent tracked outcomes. Preserve each module's writer and precedence.
- Restrict art-bearing moment requests to the core. Never retry, resend, change modes or replay commands after restart.

Schedule opportunities, durable occurrence claims and arbitration remain owned by #684. Shared-palette lighting remains outside this slice; completing it does not complete the whole issue.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-art`: prepare existing compositions, persist browser selection, retain selected references and expose truthful completion.
- `hub-automation`: coordinate per-device art plans through existing tracked dispatch with current capability evidence and independent outcomes.
- `runtime-dashboard`: load the selected existing browser composition and expose only decoded visible art to presentation consumers.

## Impact

Changes affect shared event contracts, the Art owner and its private store, the core automation owner and tracker, and the Art frontend. No new dependency, host, persistent catalog owner or device transport is introduced. ADR 0012 governs messages, outcomes, retries and owner state; the existing device contracts retain their bounds. Source and disposable evidence belong here; installation and physical verification remain #687.
