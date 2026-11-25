## ADDED Requirements

### Requirement: Private status of one named coding job

Conversation SHALL answer an owner’s status question about one full coding job ID locally, using the current attempt from the authorized Jobs projection in its originating conversation. Mixed or ambiguous requests SHALL require a separate question. The status question SHALL send no job control or provider request.

#### Scenario: Status while coding continues

- **GIVEN** a readable coding job with an active attempt
- **WHEN** its owner asks for its status by full ID in the originating conversation
- **THEN** the answer identifies the attempt and the state Jobs reported at that instant
- **AND** the worker continues and the owner can send another ordinary message

#### Scenario: Private reply after permission or attempt changes

- **WHEN** the owner reads a saved status reply after restart
- **THEN** Conversation checks current permission for the conversation and the source job and attempt
- **AND** a foreign, unknown or inaccessible job reveals no job facts
- **AND** a changed attempt cannot be presented as the attempt that supplied the saved status
- **AND** later provider and title prompts receive no job facts from the private question or answer
- **AND** a request for the last owner message cannot substitute an older message for that private question
