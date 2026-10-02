## Why

[Hub #428](https://github.com/jimmie-potts/agent-device-hub/issues/428) makes the running process identifiable when different builds share a package version. It consumes the [published install contract](https://github.com/jimmie-potts/agent-device-hub/blob/96710bba52054c381035a6afabe8348d2b9bbd93/docs/install-contract.md); installation remains batched in Hub #427.

## What Changes

- Stamp the clean source revision, or explicit unknown provenance, into the Hub archive manifest.
- Read the process's own manifest once at startup and return the same build identity in authenticated health and dashboard context.
- Show version and short revision on Connections, with a copyable full revision and explicit unknown fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-hub-host`: startup-scoped build identity and truthful package provenance.
- `unified-dashboard`: inspect and copy the running Hub identity on Connections.

## Impact

Changes Hub packaging, startup metadata, the existing read endpoints, Connections and their tests. No owner, controller, storage, diagnostic instrumentation, installer or live configuration changes. Existing permissions and unhealthy status remain authoritative. The current UI candidate needs owner approval before source delivery.
