## Context

Wemo owns each plug's queue and durable requests. Its identity-checked read already reports binary power and firmware. Companions can recover the Pixoo confirmation from the tracked operation and bound owner evidence.

## Decisions

- Commit the acknowledged write and pending readback together. Use one bounded read of the same plug before leaving the writer turn. Publish the returned power and its time or mark readback unavailable.
- Keep the shared confirmation watcher and its deadlines. Extend it to Wemo power and retain the text of a previously saved Pixoo watch after upgrade.
- Store pending and recent Wemo readings in the plug's existing record. When a restart interrupted a reading, keep the transmission acknowledgment and retire that read as unavailable. A normal poll describes the current plug and cannot settle or release an uncertain write.
- Use the existing profile, error registry and command trace. An unreadable write reply still creates the hold. The maximum-on limit continues to use the core's existing power timing and shutoff policy.

## Migration Plan

Earlier Wemo records have no readbacks and earlier Conversation watches retain their brightness parameters. Verify reopen of a paused watch and a held plug, with no command replay. Mac deployment is coordinated by [#1992](https://github.com/jimmie-potts/agent-device-hub/issues/1992).
