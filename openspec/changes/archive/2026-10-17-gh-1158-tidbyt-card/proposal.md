## Why

The owner wants the approved Tidbyt glass card to become reusable after the Pixoo delivery. [Issue #1158](https://github.com/jimmie-potts/agent-device-hub/issues/1158) replaces generic Tidbyt presentation with one read-only card while keeping cloud transmission distinct from physical output.

## What Changes

- Export a browser-only Tidbyt card and shell-context adapter, reused on Home, the device page and a declared Tidbyt page.
- Keep a labelled wooden 64×32 illustration mounted across Status/Content tabs.
- Show existing owner availability, cloud acceptance and stale/unknown evidence; explain automatic and optional tiles without controls.
- Preserve the Tidbyt writer, configuration, credentials, renderer, cadence and private state. Exact last-pushed frames and installation detail remain #363.

## Capabilities

### New Capabilities

- `tidbyt-reusable-card`: Read-only card composition, evidence semantics, accessible tabs and sync lifetime.

### Modified Capabilities

- `runtime-tidbyt`: Raise the module metadata version to the existing API 1.3 required by React contributions. Device/2.0 records and cloud behavior remain unchanged.

## Impact

`modules/tidbyt` gains an explicit public frontend entry and one page descriptor. The runtime shell composes it through the existing module scope. Consumer browser checks cover the actual module and simulated cloud. No backend API, state family, root dependency, cloud/device command or durable migration is added. Source, qualified routine installation, passive client and physical evidence remain separate.
