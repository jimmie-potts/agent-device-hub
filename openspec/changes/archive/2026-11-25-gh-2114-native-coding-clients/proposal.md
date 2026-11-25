## Why

[Hub #2114](https://github.com/jimmie-potts/agent-device-hub/issues/2114) gives the owner an exact native action for a saved coding attempt in Jobs. Job IDs, worker session IDs and native application launch acknowledgements describe different things.

## What changes

- Offer saved terminal continuation for selected, verified local subscriptions.
- Offer a one-way Claude Desktop takeover where the owner qualifies that client on the worker host.
- Bind both actions to the attempt and arbitrate write control on the worker. Keep the original result and attempt history.
- Show the last native observation and the limits on what the Hub can see.

## Capabilities

### Modified capabilities

- `bunny-coding-delegation` gains exact native client handoffs for a saved attempt.

## Impact

Jobs, the companion module, worker host, coding command and progress contracts, and the worker guide.
