## Why

[Hub #680](https://github.com/jimmie-potts/agent-device-hub/issues/680) delivers art on request, with a private gallery, favorites and creative feedback, under the API route and spending limits that [#678](https://github.com/jimmie-potts/agent-device-hub/issues/678) qualified. On 2026-11-03 the owner gave OpenAI and Claude separate limits, which replaces the combined set the qualification record stated.

## What Changes

- A new shipped `modules/art`, with a provider interface over OpenAI's Image API (`gpt-image-2`) and Claude for ideas, through a fetch transport seam.
- Durable job rows, artworks, per-target compositions, renditions, provenance, bounded recent retention, permanent favorites, explicit feedback and deletion that respects references, in the module's own SQLite file.
- A spending ledger in integer micro-dollars: per-provider monthly ceilings ($150 by default) and daily paces (about $5), reservations from a price table, settlement from reported usage, a single 30-call loop guard, and no retry.
- Local Lanczos reduction to 64×64 and 64×32 with a 32-color palette, sprite-sheet slicing and validation, GIF assembly, and local motion as the fallback.
- Prompt context limited to the owner's text, imagination, time, season and weather condition words. Stale or missing weather makes no claim.
- A new `art/2.0` state family and `content` references for #682, #683 and #684.
- Typed seams for `art-request`, `art-auto`, `art-dispatch` (#679) and weather (#1418), none of which is on `main`. Until they are wired the shipped module admits no command.
- Diagnostic profile 1.8, which registers the provider call's span, `bunny.art.call`. The runtime writes profile 1.8.
- The qualification record's limits and traces now state separate limits per provider.

## Capabilities

### New Capabilities

- `bunny-art`: generation, spending limits, the private catalog, local image work, prompt context, the state family and the seams.

### Modified Capabilities

- `shared-observability-contract`: profile 1.8 adds one span name.

## Impact

- **Code:** `modules/art/` (new); `packages/event-contracts/src/v2/art-state.ts` and its schema (new); `packages/observability` and `packages/sdk/src/spans.ts` for profile 1.8; `apps/runtime/src/record.ts`.
- **Storage:** a new `art.sqlite`, a durable owner, admitted by the upgrade inventory and preflight.
- **Dependencies:** `@jimmie-potts/bunny-observability` moves to 1.8.0. `sharp` and `gifenc` keep the versions the repository pins. No new third-party package.
- **Effects:** none on devices. Tests use fake providers and synthetic images; no key is read.
- **Docs:** `modules/art/README.md`, `docs/development.md`, `docs/art-generation-qualification.md`, `docs/observability-contract.md`, `docs/bunny-container.md`, `apps/runtime/UPGRADE.md`.
