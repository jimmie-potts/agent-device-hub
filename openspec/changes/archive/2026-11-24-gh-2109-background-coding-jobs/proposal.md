## Why

An approved coding delegation holds its Conversation turn until the worker reports a result. [#2109](https://github.com/jimmie-potts/agent-device-hub/issues/2109) makes the job independent of the turn so Conversation stays available.

## What changes

- Save a job before dispatch and show its stable Hub ID in the originating exchange.
- Deliver results by attempt and keep existing tracked start evidence.
- Separate cancellation of a Conversation turn from stopping one coding job, and recover pending records without resending ambiguous starts.

## Capabilities

### Modified capabilities

- `bunny-assistant-tasks`: a coding job does not hold a Conversation turn.
- `bunny-coding-delegation`: Companions owns the durable job and its attempt.

## Impact

Companions storage, assistant graph and coding coordinator. The worker and core continue using their existing tracked operation and progress contracts.
