## ADDED Requirements

### Requirement: Created artwork in a Conversation reply

An enabled companion artwork tool SHALL propose a still image or animated GIF for owner approval and SHALL use the existing art service to create and retain the result. Conversation SHALL associate one private attachment reference with the originating companion and reply. Reading or reopening the reply SHALL perform no generation or device command.

#### Scenario: Approved still and GIF appear in their respective replies

- **WHEN** the owner approves one still image and one animated GIF on separate turns and the art service completes both jobs
- **THEN** each reply shows the exact saved rendition and an accessible description, and reopening the thread after switching companions shows the same attachments and older text-only messages
- **AND** the GIF shows a still frame when reduced motion applies and has an explicit play control that reveals its distinct frames

#### Scenario: The art result fails or becomes unavailable

- **WHEN** the job fails, is refused, or has an uncertain outcome, or the referenced media cannot be read
- **THEN** the reply stays readable and reports the actual generation outcome or unavailable attachment without resending work
- **AND** a duplicate completion adds no additional attachment

#### Scenario: Private media remains behind the existing reader

- **WHEN** the browser opens an attachment
- **THEN** it reads the exact rendition through the existing authenticated media path, and generation and read failures remain correlated by the private turn and art references without placing media in model prompts or diagnostics

#### Scenario: Art completes after its admission reply is lost

- **WHEN** approved generation completes after Conversation loses the admission reply
- **THEN** the single saved reply reference resolves to that job's artwork and no work is sent again

#### Scenario: The art catalog reaches its recent limit

- **WHEN** a newer job pushes Conversation artwork past the ordinary recent limit
- **THEN** the referenced artwork remains available when the user reopens the conversation, unless it was explicitly deleted
