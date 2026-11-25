## Why

Background coding jobs can outlive the Conversation turn or chat that
requested them. The owner needs to inspect and direct one job while other jobs
and ordinary chat continue. [Hub #2113](https://github.com/jimmie-potts/agent-device-hub/issues/2113)

## What Changes

- Give Conversation job receipts a card and offer a shared Jobs page across profiles.
- Page the authorized job history and link each job back to its original conversation.
- Bind message and stop requests to a job and its current attempt. Ask the owner when a message does not identify one eligible job.
- Show separately what the Hub recorded, what a harness accepted and what activity it observed.

## Capabilities

### Modified Capabilities

- `bunny-coding-delegation` gains owner job inspection and attempt-specific controls.
- `bunny-assistant-tasks` keeps ordinary Conversation independent of explicit job instructions.

## Impact

Companions module, dashboard, existing authenticated content and typed command
boundaries, and disposable browser fixtures. Attempt identity and metadata come
from the shared coding attempt contract.
