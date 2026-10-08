# Adopt SDK full-disk classification in runtime storage consumers

## Why

The SDK now provides `fullDisk(error)` for wrapped SQLite `SQLITE_FULL` and filesystem `ENOSPC` errors. Runtime core and device modules still classify only a local SQLite error code, so wrapped/full-filesystem failures lose their capacity outcome and can be treated as generic failures.

## What changes

- Use the SDK helper for core store startup and transaction failures, retaining core lease `SQLITE_BUSY` handling.
- Use the SDK helper for LIFX, Tidbyt and playback storage failures, retaining explicit `SdkError` precedence and playback `BUSY`/`LOCKED` unavailable outcomes.
- Add consumer-level wrapped-ENOSPC tests with side-effect and state assertions, preservation tests, and a workflow guard against reintroducing local checks.
- Keep admission, diagnostics, outcome and recovery behavior intact. This does not add network/cloud capacity classification or alter the SQLite adapter.

## Owning issue

[GitHub issue #1010](https://github.com/jimmie-potts/agent-device-hub/issues/1010): SDK full-disk classification adoption. Acceptance requires each consumer's wrapped filesystem-error regression and a negative control showing the previous local check fails it.
