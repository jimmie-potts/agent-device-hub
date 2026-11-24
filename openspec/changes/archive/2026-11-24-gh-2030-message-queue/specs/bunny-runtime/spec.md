## ADDED Requirements

### Requirement: Message queue controls through the gateway

The gateway SHALL send an `assistant-control` action as version 2.2 when it is `withdraw`, `reorder` or `resume-queue` ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)), as 2.1 when it is `rename` and as 2.0 otherwise, and SHALL refuse a queue action that does not fit its schema with `invalid-request` before dispatch. The core's state-family classification SHALL list `assistant-state/2.2` with no bookkeeping member.

#### Scenario: Queue controls through the gateway
- **WHEN** the operator sends a cancel, a withdraw, a reorder to the end and a resume-queue, and then a withdraw without a queued message, a reorder without a position, a resume-queue with a task and a withdraw without a profile
- **THEN** the cancel is dispatched as `assistant-control/2.0`, the three queue actions as 2.2, and every malformed one is refused with `invalid-request` without dispatch
