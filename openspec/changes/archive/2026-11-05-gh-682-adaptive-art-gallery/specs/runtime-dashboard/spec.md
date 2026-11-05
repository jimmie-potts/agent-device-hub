## ADDED Requirements

### Requirement: Module-owned accessible art presentation
The runtime dashboard SHALL expose the shipped art widget and Gallery through its existing authenticated module frontend and card catalog. It SHALL reuse the shell's connection and tracked-command controls, without polling, generated application code or a second persistent catalog. The presentation SHALL retain keyboard focus, touch controls, visible stale/unavailable feedback and accessible captions at desktop and 320/390px widths in both browser appearances.

#### Scenario: Browse art with keyboard and a narrow screen
- **WHEN** the owner opens Gallery, selects a saved composition and operates its explicit controls using the keyboard at 390px
- **THEN** controls and captions remain visible without horizontal overflow, focus is visible and browsing sends no command

### Requirement: Presented art supplies presentation metadata
The art frontend SHALL expose only the identity, validated palette and readiness/freshness of art actually decoded and presented. A pending catalog update SHALL NOT replace that presentation metadata. Missing or stale evidence SHALL remain explicit. This metadata SHALL be transient presentation state, with the art module remaining the catalog owner and the core remaining the layout owner.

#### Scenario: A new catalog entry is pending
- **WHEN** the catalog announces new art while its rendition is loading
- **THEN** presentation consumers retain the visible artwork's palette until the new image is decoded and displayed
