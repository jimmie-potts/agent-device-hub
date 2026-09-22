## Why

[Hub #137](https://github.com/jimmie-potts/agent-device-hub/issues/137) fixes the observed Codex Desktop start/stop/next-start failure recorded in [Pixoo #34](https://github.com/jimmie-potts/divoom-app-upgrade/issues/34#issuecomment-5769993937). The provider supplies turn identity without qualified ordering, while the current reducer makes ordinary successive turns persistently ambiguous.

## What Changes

- **BREAKING**: allow a previously unseen, valid turn start to establish best-effort current activity when no qualified ordering governs that activity. Preserve unknown provider ordering and the documented risk from an unseen delayed start.
- Complete the selected turn on its matching stop. Apply new-turn notice clearing independently for each consumer, preserving attention and explicit acknowledgment.
- Bound remembered superseded identities, suppress known stale events and duplicate transitions, and recover existing ambiguous sessions through fresh starts without resetting saved state.
- Exercise the actual normalizer and packaged hook, persisted recovery, and pinned real Pixoo/Nanoleaf consumers using disposable state and fake device transports.
- Publish new agent-state and Hub artifact versions with unchanged version 1.0 snapshot/storage shapes, reproducible hashes and an installed-update runbook.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: current-turn selection, bounded stale-event rejection, recovery and compatibility for the accepted best-effort policy.

## Impact

The shared reducer, its tests and immutable package versions change. The existing [lifecycle contract](../../../docs/agent-lifecycle-contract.md), consumer snapshot shape and controller contracts remain version 1.0. Pixoo and Nanoleaf retain presentation policies and their designated writers. Source delivery does not install hooks, access live state, relocate the owner, operate devices or deliver reset/history features. Hub PRs #135 and #136 require shared-file reconciliation but supply no required semantic input. The coordinator owns this candidate and maintained work-guide inputs; public publication remains separate.
