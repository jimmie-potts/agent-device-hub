# bunny-preferences Specification

## Purpose

Let the owner inspect and manage explicit private preferences, select active text for manual use and move the library without replacing current choices.

## Requirements

### Requirement: Inspectable preference lifecycle

The system SHALL retain stable preference IDs, title, text, active state, timestamps and private change history. New explicit entries SHALL be active. Editing SHALL preserve usage state; only explicit Reactivate SHALL reactivate an inactive entry.

#### Scenario: Manage across restart

- **WHEN** the owner adds, edits and stops using an entry, edits it while inactive and restarts
- **THEN** its identity, latest text, inactive state and original history remain inspectable
- **AND** explicit reactivation makes the current entry usable again

### Requirement: Active-only use

Normal retrieval and manual copying SHALL include only current active entries. Management and export SHALL retain inactive entries and history. Preferences SHALL grant no permissions or device-state authority and SHALL NOT be inserted automatically into model context.

#### Scenario: Copy selected preferences

- **WHEN** an owner copies selected entries after one has been deactivated
- **THEN** only selected entries that are currently active appear in the copied text, with no historical text

### Requirement: Additive private portability

Versioned private JSON SHALL preserve library contents, states and provenance/history. Import SHALL preserve all existing entries by stable ID and add missing entries inactive, retaining imported history and recording that import. No duplicate ID, older export or repeated import SHALL overwrite or reactivate an existing entry.

#### Scenario: Import into an existing and fresh library

- **WHEN** an export containing active and inactive entries is imported into a library with a locally edited matching ID
- **THEN** the matching record remains unchanged and missing records arrive inactive
- **AND** a repeat import adds no duplicates, while an empty library also receives every imported entry inactive

### Requirement: Atomic refusal and private boundaries

Unsupported, malformed or over-limit input SHALL be refused without library changes. Failed transactions SHALL preserve previous data. Authenticated control SHALL be required for mutations; content SHALL remain outside shared state, command metadata, outcomes and diagnostics.

#### Scenario: Reject an import without partial effects

- **WHEN** an import has an invalid record or its transaction fails after one insertion
- **THEN** no imported entry is retained and the previous library and revision remain unchanged

#### Scenario: Unauthorized access and recovery

- **WHEN** an anonymous client reads preferences or a read-only client attempts a mutation
- **THEN** access is refused according to the existing grants, and no write occurs
- **AND** restart or duplicate control never replays a preference mutation

### Requirement: Accessible dashboard management

The existing dashboard SHALL provide inspect/add/edit, Stop using, Reactivate, selected copy and private import/export with keyboard access and truthful disconnected, refusal and uncertain-result states. Existing assistant and fixed-text companion behavior SHALL remain available independently.

#### Scenario: Use the page without a pointer

- **WHEN** the owner navigates the controls by keyboard, saves an entry, exports and imports a library
- **THEN** labels, focus and status communicate the results, and read-only or disconnected controls cannot mutate state
