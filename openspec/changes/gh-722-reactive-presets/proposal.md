## Why

The Music effect preview keeps only an unsaved draft. The operator needs reusable custom reactive recipes that survive reload and restart, as required by [#722 AC4](https://github.com/jimmie-potts/agent-device-hub/issues/722).

## What Changes

- Save up to 32 immutable named V1 reactive recipes in Nanoleaf's private store through an explicit guarded metadata command.
- Sync the bounded library, inspect and load recipes into the existing Wall preview, including every frozen effect parameter.
- Preserve the existing built-in preview request and add a closed full-recipe request for truthful synthetic preview of saved recipes.
- Reject unsupported parameters, stale saves and capacity failures without replacing earlier presets or changing devices.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-module`: private reactive recipe save/reload and full-recipe synthetic preparation.

## Impact

Nanoleaf owns the additive SQLite tables, two module-owned profile-2 families, outbox metadata outcome and existing Wall React entry. Existing SDK sync, tracked commands, authentication and errors are reused. Core capture/calibration settings, static favorites, decorative timelines, legacy 1.x contracts and device writers retain their owners and behavior. This source increment selects no source, collection, installation, live rendering or physical operation; remaining #722 acceptance stays with its owning issue. The comparison starts at the frozen synthetic-preview candidate d7d7213df069aa87d02a0e5c3f885d0577d04cfa.
