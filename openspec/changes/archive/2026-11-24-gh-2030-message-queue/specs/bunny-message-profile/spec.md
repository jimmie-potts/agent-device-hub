## ADDED Requirements

### Requirement: Conversation message queue contracts

The package SHALL register `assistant-control/2.2` and `assistant-state/2.2` ([Hub #2030](https://github.com/jimmie-potts/agent-device-hub/issues/2030)). `assistant-control/2.2` SHALL be `assistant-control/2.1` with the actions `withdraw` and `reorder`, which SHALL carry a `profile` and a `queuedId`, the request ID that queued the message, and for a reorder a `beforeId`, a queued message's request ID or null for the end, and `resume-queue`, which SHALL carry a `profile` alone; none SHALL carry a task, message or title, and every other action SHALL carry no queued message or position. `assistant-state/2.2` SHALL be `assistant-state/2.1` with a required `queues` list of 1 to 3 entries, each with a `conversationId`, a `profile`, `messages` from 1 to 8, `held` (`stop`, `restart`, `refused` or null) and a refusal's `code`, and no message text. A test SHALL keep the 2.1 members of `assistant-control/2.2` unchanged.

#### Scenario: Queue commands
- **WHEN** an `assistant-control/2.2` withdraw, reorder or resume-queue names what it needs, omits its profile, queued message or position, adds a task, a position to a withdraw or a queued message to another action, or is sent as 2.1
- **THEN** only the first are valid, and the 2.1 actions stay valid in both versions

#### Scenario: Queue state
- **WHEN** an `assistant-state/2.2` lists a queue of 1 to 8 messages with each hold, an empty list, 9 messages, an unknown hold or a text, or the queues are sent as 2.1
- **THEN** only the first are valid, and 2.2 keeps 2.1's tool bound
