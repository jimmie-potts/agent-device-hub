## ADDED Requirements

### Requirement: Returned steers past the queue limit in assistant state

The package SHALL register `assistant-state/2.3` ([Hub #2031](https://github.com/jimmie-potts/agent-device-hub/issues/2031)) as `assistant-state/2.2` with a queue's `messages` allowed from 1 to 16, so the queue a stopped or closed turn returns its unread steers to can pass 8; every other member SHALL be 2.2's, and it SHALL carry no message text. The companions module SHALL publish 2.3 only while some queue holds more than 8 messages. A test SHALL keep the other members equal to 2.2's.

#### Scenario: Queue count in 2.3
- **WHEN** an `assistant-state/2.3` lists a queue of 1, 8, 9 or 16 messages, or one of 0 or 17, a text or an unknown hold, or a queue of 9 is sent as 2.2
- **THEN** only the first four are valid
