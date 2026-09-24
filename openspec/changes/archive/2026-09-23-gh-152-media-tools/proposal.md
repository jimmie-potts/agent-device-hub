## Why

[Hub #152](https://github.com/jimmie-potts/agent-device-hub/issues/152) lets an authorized local MCP client start a saved playlist and control playback through the same controller service as the frontend. The controller v1 media commands already exist; the hub lacks their tool bindings.

## What Changes

- Register `_media_start` and `_media_control` under every configured alias, forwarding one guarded controller v1 command per call.
- Reuse the existing authorization, owner capability rejection, extension envelope and uncertain-write handling.
- Describe explicit Pixoo Media selection through the integration tools, with no automatic mode switch or restoration.
- Cover the new bindings in the existing host MCP and offline package suites.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-mcp`: Saved-playlist and playback tool bindings with strict inputs, current permissions and preserved owner results.

## Impact

Only host registrations, their tests and host/development documentation change. [Controller v1](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/controller-contract.md), the reusable MCP module and [ADR 0005](https://github.com/jimmie-potts/agent-device-hub/blob/main/docs/decisions/0005-general-device-controls.md) remain authoritative. Pixoo catalog/rendition handlers remain device-owned. Installation, real-client qualification and physical acceptance are separate.

## Design assessment

The `spec-driven` design criteria do not require a separate design artifact: this adds two registrations to one existing helper, with no new architecture, dependency, data model, security mechanism, performance or migration complexity, or unsettled decision. The existing helper preserves fixed ownership, bounded admission, request guards, safe failures and explicit replay. The tools neither schedule work nor retain private media data.
