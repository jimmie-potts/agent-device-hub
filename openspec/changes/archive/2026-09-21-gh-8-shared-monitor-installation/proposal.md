## Why

[Hub #8](https://github.com/jimmie-potts/agent-device-hub/issues/8) needs reversible producer configuration now that the host and both consumers are source-delivered. Hand editing hooks and credentials risks duplicate ingestion and overwriting unrelated user settings.

## What Changes

- Add Linux/WSL inspect, plan, apply and remove tooling with private ownership receipts, configuration diffs, backup and conflict detection.
- Package a silent authenticated hook using the shared provider normalizer, explicit qualification and one configuration per source.
- Coordinate producer credentials, Nanoleaf's owned source-selection interface and the existing quiesced host migration, with recovery and explicit rollback.
- Expose sanitized setup inspection and document trust review, version evidence, Windows-to-WSL invocation and separate installed acceptance.

The owner selected Linux/WSL on September 21, 2026. Native Windows installation is excluded. Source delivery does not install personal hooks, launch clients, migrate live state or operate devices.

## Capabilities

### New Capabilities

- `shared-monitor-installation`: Reversible setup, credential lifecycle, consumer cutover and sanitized inspection.

### Modified Capabilities

None. The standalone host's existing one-owner and fenced-migration requirements remain mandatory.

## Impact

`apps/hub`, source packaging, tests, development/runbook documentation and the maintained work guide. Reuse [Pixoo monitor v1](https://github.com/jimmie-potts/divoom-app-upgrade/blob/28f4875b7a0f0e57ca6f25d9971e125e927a5503/docs/agent-monitoring.md) and [Nanoleaf shared input](https://github.com/jimmie-potts/codex-nanoleaf/blob/5375a3088522507c7f207c6e9c824454db1e1d5f/docs/shared-input.md). Controller databases and physical writers remain private to their owners.
