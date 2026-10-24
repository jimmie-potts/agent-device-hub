## Why

The owner selected Soft keys and requested a reusable ONN dashboard card in [#1210](https://github.com/jimmie-potts/agent-device-hub/issues/1210). Home currently shows generic device facts while the ONN page has a separate text-heavy remote; both should use the approved quiet presentation and the existing safe command path.

## What Changes

- Export a module-owned presentation and shared status/command adapter through `./frontend`.
- Replace Home/component ONN facts with the Soft keys card and reuse it on the controls page.
- Keep the TV illustration mounted and Remote/Apps geometry stable, including reduced motion and keyboard access.
- Preserve existing keys, shortcuts, focused text restrictions, observed-app freshness, outcomes and no replay.
- Link to an additive module-local History page composed from the existing bounded history UI; preserve history on the existing controls URL too.
- Validate actual simulated browser journeys, independent reviews and routine passive installed acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `onn-controls`: reusable Soft keys presentation and guarded placement on Home/component/module views, with an owning History link.

## Impact

ONN frontend/presentation, the module's additive page declaration, runtime dashboard placement, existing ONN browser/module tests and owning guides. No command, transport, state schema, reader artifact, collection, history semantics, dependency or primary navigation change. Follows ADR 0012 and the existing diagnostic contract through shared SDK/Command handling. Source tests are synthetic; installed passive acceptance and physical TV effects remain separate.
