## Why

Conversation currently applies provider-specific sharing rules. The owner chose
one model sharing policy so the same request can use either configured
supervisor with the same permitted inputs. [Hub #2180](https://github.com/jimmie-potts/agent-device-hub/issues/2180)

## What changes

- Select bounded same-conversation context, relevant device facts and requested
  device history in Companions. Apply the same policy before either hosted
  supervisor can see them.
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
