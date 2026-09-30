## Why

[Hub #612](https://github.com/jimmie-potts/agent-device-hub/issues/612) needs to tell a coordinator what is missing before a preview attempt, following the accepted [#610 boundary](https://github.com/jimmie-potts/agent-device-hub/issues/610). Current doctor inspects existing runs; it is not a prerequisite check and cannot turn unread host evidence into successful qualification.

## What Changes

- Add shared `prerequisites` CLI/API with local read-only checks, explicit missing/unknown/unsupported states and separate launch/capture/handoff summaries.
- Add an optional read-only adapter hook and Hub build freshness check.
- Advertise support in help; old consumer help without the operation explicitly means unsupported until owned adoption.
- Publish source package version 1.3.0 while preserving receipt version and existing operations; update the Hub composition core expectation only.

## Capabilities

### New Capabilities
- `verification-prerequisites`: report local requirements without launching a preview or claiming runtime qualification.

### Modified Capabilities
None. Existing lifecycle operations remain authoritative.

## Impact

Shared app-verify CLI/types/package, Hub plug-in and build/version compatibility, source/package tests and documentation. Nanoleaf/Pixoo pinned 1.1.0 adapters explicitly remain unsupported for this new diagnostic; their existing lifecycle is unchanged. Host-source delivery and actual client/browser acceptance remain separate.
