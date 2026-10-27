## Why

Installed Recent readback for [#1194](https://github.com/jimmie-potts/agent-device-hub/issues/1194) loaded the complete retained archive; two unbounded reads were followed by runtime kills and restarts. Timeline needs a bounded matching window before the reusable card can meet installed acceptance.

## What Changes

- Add optional `limit` (integer 1..500) to the existing shared HTTP/MCP history filter; select the latest matching committed rows before decoding, preserving oldest-first output and omitted-limit behavior.
- Request 200 entries for every Timeline read. Identify the result window and keep categories and Show more local to it.
- Cover larger synthetic archives, validation, compatibility and passive browsing; reverify the established installation with bounded reads only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shared-inbox-history`: Optional latest-matching-row limit on existing HTTP and MCP reads.
- `timeline-card`: A 200-entry read window with truthful category and empty-state labels.

## Impact

Core history, gateway query parsing, shared MCP schema and dashboard query/presentation, their tests and owning guides. No cross-repository contract, endpoint, message family, storage migration, collection, retention or device authority changes. Row count is bounded, not bytes or filtered scan time; omitted-limit callers retain their previous behavior.
