## ADDED Requirements

### Requirement: Viewport-filling Conversation workspace

The Conversation page SHALL use remaining viewport height for the transcript and keep the composer in view when the controls fit. The page SHALL retain the Hub navigation and existing companion page links, and distinguish the everyday B.U.N.N.Y. profile from the Reachy and MicroDuck demo chat profiles before selection.

#### Scenario: Read and compose in the available viewport
- **WHEN** the owner opens an empty or short conversation on desktop or a narrow phone viewport
- **THEN** the selected profile, transcript and composer fit without scrolling the document, and additional viewport height increases the transcript height
- **AND** a long decision or constrained viewport still allows scrolling to read its full text and reach every action

#### Scenario: Browse profiles and companion pages
- **WHEN** the owner inspects the chat choices or opens Companion pages
- **THEN** both demos are labelled before selection and the device-management links remain distinct from the chat choices
- **AND** the companion navigation retains its existing links and current page indication
- **AND** switching to a demo while another profile has unfinished work allows inspection of its separate history without a conflicting start

#### Scenario: Resize or open local navigation while reading
- **WHEN** the owner resizes the viewport or opens and closes Companion pages without leaving Conversation
- **THEN** the mounted conversation keeps the reading position and draft, and sends no command or additional speech endpoint registration
