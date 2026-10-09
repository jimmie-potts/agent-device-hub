## Why

[Hub #934](https://github.com/jimmie-potts/agent-device-hub/issues/934) moves the existing Nanoleaf wall editor into B.U.N.N.Y.'s runtime dashboard so the fresh runtime has the editor its module already supports. The port preserves the current wall and Prism interactions without making the deferred React wall rewrite a cutover prerequisite.

## What Changes

- Declare one Nanoleaf Wall page using module API 1.3 and a browser-only React contribution. A small React host mounts the existing imperative wall editor and Prism renderer, supplies the shell's authenticated reads and tracked commands, and disposes their local resources on exit.
- Follow the Nanoleaf owner's wall and device records on the shell connection. Serve a bounded, sanitized connector-layout reference from saved geometry only; never discover geometry or contact a controller when opening the page.
- Preserve device selection, wall selection and keyboard controls, task/project inspection, mode and wall edits, palette, orientation, Locate, eviction, local assembly and number preferences. Retain the qualified Codex Desktop navigation link without exposing arbitrary URLs or credentials.
- Reuse the dashboard's observed-power card and existing command outcomes, authorization and Origin checks. Opening, selecting and drafting on the page sends no command and changes no saved scene or device.
- Retarget focused browser, accessibility and catalog checks for these controls. Keep installation and physical acceptance at the owner-present cutover; no data migration, geometry discovery, new editor framework, service or broad legacy test campaign is added.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nanoleaf-module`: declare the integrated wall editor, cached geometry read, preserved editor behaviors and authenticated tracked actions, with no effects on page open.

## Impact

The implementation belongs in `modules/nanoleaf` with its browser entry, page declaration, content projection, tests and provenance. The coordinator owns shared build/lockfile/CI declarations and dashboard browser/scenario harness wiring. The SDK, gateway and shell contract from [#932](https://github.com/jimmie-potts/agent-device-hub/issues/932) is consumed unchanged.

The source is [codex-nanoleaf at c711e1812d6871952562e9070e20bdebe120db3a](https://github.com/jimmie-potts/codex-nanoleaf/tree/c711e1812d6871952562e9070e20bdebe120db3a), especially `bridge/wall.html`, `bridge/prism*.js`, `bridge/assets/prism` and the focused browser checks. Ownership follows [ADR 0007](../../../docs/decisions/0007-bunny-shell.md), frontend integration follows [the accepted React direction](../../../docs/architecture.md#module-frontend-ownership), and communication and privacy follow ADR 0012 and ADR 0011. Existing installed contracts and services remain unchanged. [#761](https://github.com/jimmie-potts/agent-device-hub/issues/761) remains outside this port.
