## Why

The accepted Mac browser profile has no producers. Local Codex Desktop and CLI
share hook configuration but provide no supported client discriminator. Issue
[#1183](https://github.com/jimmie-potts/agent-device-hub/issues/1183), under #566,
connects those local sessions using an honest shared identity and metadata only.

## What Changes

- Add Codex `client: local` to the existing lifecycle and session contracts and
  current runtime consumers, preserving the existing client meanings.
- Reuse the bounded SDK hook through a root-event sanitizer that prevents file
  enrichment and leaves the computer-use notify integration unchanged.
- Allow one explicitly selected ingest-only source in the Mac browser profile.
  The native producer retains the private bearer; the hub retains its digest.
- Qualify installed local Desktop and CLI hooks separately from synthetic tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-lifecycle-contract`: shared local Codex identity without Desktop-only privileges.
- `runtime-agent-hooks`: bounded root-only metadata producer without file enrichment.
- `bunny-container-operator`: optional single-source local ingestion with unchanged isolation.

## Impact

The additive identity touches lifecycle schemas, state snapshots and the existing
session consumers. No new message format, transport, owner, polling path or
device control is introduced. Cloud-orchestrated tasks, PC ingress, Wispr,
historical imports and physical devices remain outside this increment.
