## Why

Conversation currently applies provider-specific sharing rules. The owner chose
one model sharing policy so the same request can use either configured
supervisor with the same permitted inputs. The active conversation is the
default working context for both supervisors. [Hub #2180](https://github.com/jimmie-potts/agent-device-hub/issues/2180)

## What changes

- Use eligible messages from the active conversation in saved order for both
  hosted supervisors. Fit them to the selected model’s token allowance and
  compact older exchanges into a bounded continuity summary when needed.
- Apply the common policy to device facts and requested device history before
  either hosted supervisor can see them.
- Normalize legacy model grants without overwriting private configuration.
  Keep disputed or denied fields private and make conflicts visible locally.
- Check current grants at discovery, paging and provider submission, including
  replay. Keep title and coding hand-off purposes separately scoped.

## Capabilities

### New capabilities

### Modified capabilities

- `bunny-assistant-tasks` uses a shared external-model policy for context,
  disclosure, replay, title requests and bounded device history.

## Impact

Companions owns the selector and disclosure checks. Existing adapters own their
provider's request format, continuation items, caching and size limits.
[ADR 0011](../../../docs/decisions/0011-private-personal-data-retention.md)
records the changed authority. The existing runtime, device contracts and
coding-worker approval path provide the bounded inputs.
