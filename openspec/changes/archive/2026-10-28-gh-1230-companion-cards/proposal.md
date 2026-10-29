## Why

[Hub #1230](https://github.com/jimmie-potts/agent-device-hub/issues/1230) brings the accepted quiet companion-card design into the runtime dashboard. Reachy's full page and MicroDuck's older Home widget currently use different layouts and cannot supply the same compact controls across destinations.

## What Changes

- Reuse one module-owned card per companion on Home and companion pages.
- Keep illustrations mounted while accessible tabs animate only their control faces.
- Add an optional Reachy Home placement and retain the existing MicroDuck placement ID.
- Reuse explicit conversation selection and qualified browser speech without adding output routes.
- Retain detailed evidence and existing tools on the owning pages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-dashboard`: reusable quiet companion cards, Home placement and guarded control tabs.

## Impact

The companions frontend and its fixed page manifest, runtime Home catalog/composition, existing companion browser journeys, and owning guides/spec change. Existing SDK, content routes, commands, stores and speech policy remain authoritative. No controller contract, root dependency or CI job changes are needed. Installed software acceptance follows the selected established target's owning procedure; physical speech and robot qualification remain separate.
