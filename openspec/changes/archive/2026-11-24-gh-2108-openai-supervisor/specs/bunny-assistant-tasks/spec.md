## ADDED Requirements

### Requirement: Per-task companion supervisor

For [Hub #2108](https://github.com/jimmie-potts/agent-device-hub/issues/2108), every companion SHALL offer the configured hosted supervisors for a new Send or Queue. The selected supervisor SHALL be independent of coding-worker selection and SHALL follow the task through questions, tool results, steers and recovery. Hosted tasks SHALL pin their supervisor, model, effort and pricing before admission. A task whose prior provider is ambiguous or whose matching configuration is unavailable SHALL remain readable and unable to resume. A request refused by one provider SHALL have no automatic retry or fallback. The existing Anthropic turn and title rules apply to Anthropic tasks. OpenAI tasks SHALL use the Responses contract and the sharing grant in ADR 0011.

#### Scenario: Resume a task after selecting another supervisor

- **GIVEN** OpenAI and Anthropic are available and an OpenAI task waits on a clarification
- **WHEN** the owner queues an Anthropic task, restarts and answers the active question
- **THEN** the answer and the opaque items from the active task reach only its pinned OpenAI supervisor, and the queued task retains Anthropic for its own start

#### Scenario: Limit an OpenAI disclosure before a model call

- **GIVEN** a current OpenAI task, private preferences, unrelated sessions and messages in other conversations
- **WHEN** the task requests a model turn or title
- **THEN** the OpenAI request contains only the allowed current owner request and relevant scoped data for that purpose, and a revoked disclosure prevents opaque replay

#### Scenario: A paid Responses call loses its answer

- **GIVEN** a shared ledger with reservations from both hosted supervisors and their title calls
- **WHEN** OpenAI usage remains unknown after an uncertain call
- **THEN** the pinned worst-case reservation remains counted, and another call that would exceed the shared guard is refused before submission
