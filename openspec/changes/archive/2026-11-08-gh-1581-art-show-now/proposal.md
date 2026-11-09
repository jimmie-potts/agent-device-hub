## Why

[Issue #1581](https://github.com/jimmie-potts/agent-device-hub/issues/1581): today saved art reaches the Pixoo, the Tidbyt or the browser only through the daily schedule. The gallery's "Create art" generates and stages compositions but starts no display moment, and nothing in the dashboard, the automation page or the gateway shows art now. During the #687 trial on 2026-11-08 the owner waited hours between slots to observe one Pixoo appearance and had nothing to run on demand when a fix landed.

## What Changes

- Add one core-owned command family, `art-show/2.0`, on `bunny.cmd.art-show.hub`, accepted from the dashboard and the MCP gateway through the existing tracked dispatcher with the Hub mode's admission. It carries `artworkId`, one to three `targets` (configured display IDs and `browser`) and an optional `coversStatus`, default true.
- The core builds the existing art plan from the owner's saved artwork, with a start 20 seconds ahead, the schedule's tolerance and preparation cutoff, `priorityClass` `event`, the request's `coversStatus` and the default durations (Pixoo 10 s, Tidbyt 30 s), then runs `ArtPlans.present` with an owner permit. The permit passes quiet hours, budgets, spacing and the schedule policy, and still refuses while attention is raised; holds, pins, Now Playing and each display's admission still decide through the existing path. Each surface keeps its own tracked operations.
- Refusals use the shared registry: `not-found` for an artwork outside the current art record or an unconfigured display, `unsupported-capability` for a target without a usable composition (the other targets proceed), `capacity` while another owner show prepares, `forbidden` without dispatcher admission or control scope, and `invalid-request` for schema faults. The show's own operation completes `succeeded` with `observed` once its plan has handed every surface off, and `failed` when no surface was sent.
- Record each surface in the automation log beside rule and routine attempts as an `art-show` row with origin `owner` and `priorityClass` `event`, so the Automation page's Recent attempts lists it and no flourish budget or spacing counts it. The schedule's claims, daily count, spacing watermark and next appearance are untouched.
- Add a "Show now" control to the art gallery, with surface choices defaulting to the browser and every configured display, and the MCP control tool `core_art_show` with the same payload and refusals. Both report per-surface outcomes from the core's operation records and never present transmission as display. A read route, `GET /api/v2/automation/art/targets`, lists the configured art displays.

Adjustments to the issue's proposed decisions, recorded on the issue: owner evidence goes to the automation log (Recent attempts) rather than a new `origin` on the art-schedule state record, which avoids a state schema and private store change and cannot overwrite or suppress the schedule's own latest attempt; and a show can name only artwork in the art owner's published record (its 24 most recent), because that is the core's only source of composition identities.

## Capabilities

### New Capabilities

None. Art, scheduling, presentation and display ownership already exist.

### Modified Capabilities

- `bunny-runtime`: the owner art show command, its admission, refusals, owner permit, evidence and its independence from the schedule; the art targets read route and the `core_art_show` MCP tool.
- `bunny-art`: the gallery's Show now control and its truthful per-surface reporting; scheduled generation still selects no presentation.

## Impact

- `packages/event-contracts`: new `art-show/2.0` schema, family registration, browser-safe identity helpers (`v2/art-show`) and fixtures.
- `apps/runtime`: `core/art-show.ts` (engine and command part), core wiring, tracker admission and the `moment` deadline class for `art-show`, art input following for owner shows, the automation route, the MCP tool, and dashboard text for the show operation and owner rows in Recent attempts.
- `modules/art`: the gallery frontend's Show now control.
- No device mode, device module, schedule policy, provider call or migration changes. Installed and physical acceptance (AC5) stay with the issue's later batch.
