## ADDED Requirements

### Requirement: Authenticated art gallery and explicit owner actions
The browser SHALL show the shared private catalog through authenticated bounded reads and live art state. It SHALL offer recent art, favorites, explicit more/less/dismiss feedback, requests and variations. A request SHALL identify its selected targets, defaulting to UI, Tidbyt and Pixoo in one owner request. A variation SHALL retain its source artwork identity. Browsing, resizing and revisiting saved art SHALL read an existing browser composition without a provider call or device command. Silence SHALL NOT become feedback. Read-only or stale controls SHALL refuse mutation.

#### Scenario: Revisit a favorite
- **WHEN** the owner opens a saved favorite from a later gallery page
- **THEN** its existing rich browser composition and provenance appear with no generation, staging or device command

#### Scenario: Request admission and generation differ
- **WHEN** a request is durably admitted but its generation is still queued or running
- **THEN** the browser reports that progress separately from command admission, and later shows the job's succeeded, partial, failed, rejected, cancelled or uncertain result

#### Scenario: Spend is exhausted or uncertain
- **WHEN** a provider reaches its limit or loses a response
- **THEN** the browser shows that provider's remaining, reserved and uncertain amounts and the job's stated reason, preserves existing art and sends no automatic retry

### Requirement: Complete rich browser art before presentation
The browser SHALL use the artwork's rich UI rendition, preserve its proportions and identify it as generated art with its supplied provenance. It SHALL validate content metadata and finish decoding all required image data before replacing the current presentation or reporting completion. Missing, malformed, refused or failed content SHALL produce an explicit unavailable state. Disconnect or incomplete sync SHALL preserve readable prior evidence marked stale. Reduced motion SHALL have a still presentation, and obsolete image loads SHALL NOT replace newer choices.

#### Scenario: A late response loses its selection
- **WHEN** the owner selects B while A is still loading and A finishes last
- **THEN** only the current successfully decoded selection can replace the visible art and obsolete resources are released

#### Scenario: New content cannot load
- **WHEN** required image data is incomplete, malformed, unavailable or undecodable
- **THEN** the browser does not report it complete or update its presented palette, and shows the failure while preserving any previous readable presentation
