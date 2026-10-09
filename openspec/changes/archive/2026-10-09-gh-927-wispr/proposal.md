## Why

[Hub #927](https://github.com/jimmie-potts/agent-device-hub/issues/927) preserves Wispr analytics in the rebuilt runtime. Reuse the selected published files and existing analytics behavior under the owner's runtime read-scope decision, without changing the Windows collector.

## What Changes

- Add a fixed `wispr` module with manually selected aggregate/diagnostics JSON files, bounded on-demand reads and no analytics database or persisted copy.
- Allow all authenticated runtime read-scoped clients; remove the extra Wispr client/source grant from the runtime port. Browser exposure and text sharing remain independently off by default.
- Preserve freshness, clear-generation fences, numeric-default exports, text opt-out and refusal of outstanding reads after authority changes.
- Port the React analytics page and preserved numeric home widget into the shared shell using the coordinator-owned frontend/content contract.
- Document the approved collector file-handoff exception to ADR 0012. Source-only delivery precedes owner-present setup at #840; no migration or collector change.

## Capabilities

### New Capabilities

- `bunny-wispr-module`: File-backed runtime module configuration, lifecycle and safe read adapter.

### Modified Capabilities

- `hub-wispr`: Runtime read-scope access, separate browser exposure and outstanding-read admission without source grants.
- `wispr-dashboard`: Shared React shell integration with the same analytics page and numeric home widget.

## Impact

Backend source and tests belong in `modules/wispr`, reusing `apps/hub/src/wispr*.ts` and `@jimmie-potts/wispr-contracts`. The coordinator owns SDK/gateway/dashboard integration, root workspace/CI changes and shared documentation. Existing `hub-wispr`, `wispr-dashboard` and `wispr-language` protections remain applicable; collector output and released old Hub behavior remain unchanged. No new service, framework, scheduler, MCP analytics, broadcasts, database or data transfer.
