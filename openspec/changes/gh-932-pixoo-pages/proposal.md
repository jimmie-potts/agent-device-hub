## Why

[#932](https://github.com/jimmie-potts/agent-device-hub/issues/932) brings the existing Pixoo library and player into B.U.N.N.Y. The current script-free module-page contract cannot host those interactive views or the existing Nanoleaf editor; the owner's 2026-10-08 decision selects a shared React shell with reviewed bundled editors as a migration option.

## What Changes

- Define module-owned React and TypeScript frontend contributions compiled into the existing dashboard, without importing Node-side module implementations into the browser.
- Add an explicit trusted-editor asset and page policy, keeping executable build assets separate from user media and retaining passive HTML behavior.
- Reuse the shell's navigation, styling, connection and authenticated command facilities. Storage, authorization, automation and device writers remain backend responsibilities.
- Port Pixoo's existing library, playlist, player, preview, Monitor and settings views with fresh state, reference media and bounded catalog pages. Qualify the shared contract with an actual tracked playlist edit.
- Preserve read-only refusal, no changes on page open, explicit commands and accurate accepted/completed/uncertain results.
- Keep #934's existing editor port and #761's later React rewrite separate. Add no framework, runtime plugin loader, service or data migration.

## Capabilities

### New Capabilities

None; these changes extend existing runtime capabilities.

### Modified Capabilities

- `bunny-sdk`: typed page presentations, declared executable assets and a browser-safe frontend entry for shipped modules.
- `bunny-runtime`: authenticated trusted page/assets and build-time browser contribution collection.
- `runtime-dashboard`: React module pages and trusted editor frames within the shared shell.
- `bunny-pixoo-module`: the existing Pixoo views through authenticated runtime reads and tracked commands.

## Impact

The SDK, gateway, dashboard build and common browser interfaces change together under this story's single contract owner. Pixoo owns its feature frontend; #934 consumes the qualified embedded-editor contract. #925's core automation and #927's file readers remain independent, with shared gateway/dashboard edits integrated by the coordinator.

Reuse `apps/dashboard/src/pixoo-media.tsx` and the staged Pixoo domain code with provenance. The old Pixoo web source in `jimmie-potts/divoom-app-upgrade` supplies existing view behavior; this change does not modify its installed service. ADR 0011 and ADR 0012 remain authoritative for privacy and command outcomes. Source delivery uses the existing independent reviews, focused browser/accessibility and disposable Acceptance, followed by PR/main CI. Installation and physical acceptance remain at owner-present #840.
