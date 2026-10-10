## Why

The shared Home and Music playback card shows text even when the playback owner has acquired a current thumbnail. [Hub #1069](https://github.com/jimmie-potts/agent-device-hub/issues/1069) adds that optional image through the current runtime's authenticated content seam while preserving the card's text and controls.

## What Changes

- The playback module serves only its current normalized PNG through module API 1.2. Reads use a generation and record revision reference, create no acquisition or publication, and refuse obsolete observations.
- Home and Music use the same card to show a bounded same-origin image. Owner, record, generation and revision associate the image with current metadata; sync loss, source replacement and unmount retire it.
- Missing, refused, stale or unavailable artwork keeps the existing text and supported controls. Loading and image errors cannot change command evidence or authority.
- Synthetic content, browser, accessibility and race checks cover both routes. Source, installation and installed-browser acceptance remain distinct.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-playback`: module API 1.2 and authenticated passive reads of the current normalized thumbnail.
- `runtime-dashboard`: optional artwork in the existing Home and Music playback card, with observation association and text fallback.

## Impact

Owning playback source, the shared runtime dashboard card and its existing authenticated catalog/content interfaces, focused tests and owning guides. Reuse playback/2.1, the SDK module content contribution, gateway read authorization, current CSP and Neon tokens. No new dependency, gateway authorization change, receiver acquisition path or browser binary cache is needed. The source prerequisite is the accepted #229 contract; the browser increment remains optional for #1054. Its installed-browser finish requires the qualified owning upgrade procedure and exact served-build evidence.
