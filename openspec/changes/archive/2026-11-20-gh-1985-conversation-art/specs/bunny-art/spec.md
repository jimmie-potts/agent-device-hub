## ADDED Requirements

### Requirement: Conversation artwork is retained without staging

Art SHALL use its existing still or bounded GIF processor for an approved `art-request/2.1`. This request SHALL produce no stage, ambient change or display operation. GIF failure SHALL keep the actual outcome rather than substituting local display motion. Art SHALL preserve Conversation artwork past the ordinary recent limit, unless the owner explicitly deletes the artwork. Its authenticated `conversation.<requestId>` content SHALL return the job's pending or final outcome, or its exact saved artwork and rendition if available.

#### Scenario: A retained GIF is read after restart

- **WHEN** a Conversation GIF completes and Art restarts or passes the recent limit
- **THEN** the job resolves to the same saved rendition and no generation or device command is sent again
