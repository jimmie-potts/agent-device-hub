# Shared Places Navigation Specification

## Purpose

Gives readers one consistent route among the public B.U.N.N.Y. documents and the two local applications without exposing application state or credentials.

## Requirements

### Requirement: Consistent place identity and order
Every Hub-owned guide, architecture viewer, atlas, reference and dashboard entry point SHALL identify its current place and present Guide, Architecture, Atlas, Reference, B.U.N.N.Y. and Wall in that order with those labels. A place other than the current one SHALL be one link away.

#### Scenario: Move from a document to another place
- **WHEN** a reader opens any generated guide, architecture viewer, atlas or reference page
- **THEN** the Places navigation has the same ordered labels, identifies the current place and links directly to each other place

#### Scenario: Move from the dashboard
- **WHEN** the operator opens the authenticated B.U.N.N.Y. dashboard
- **THEN** its Places group presents the same ordered labels and direct destinations without issuing a controller command

### Requirement: Public and local destinations
The public edition SHALL use public URLs for Guide, Architecture, Atlas and Reference. B.U.N.N.Y. and Wall SHALL use only their numeric-loopback URLs and be visibly tagged Local. The public pages SHALL work without a local service, credential or private path; the local links MAY be unavailable on a phone.

#### Scenario: Read on a phone
- **WHEN** a reader opens the public edition at 390 px viewport width
- **THEN** the four public destinations open, the two loopback destinations say Local and the Places navigation has no horizontal overflow

#### Scenario: Export the public edition
- **WHEN** the reviewed source is exported for publication
- **THEN** every exported guide, architecture, atlas and reference entry page contains the same navigation with public document URLs and only the two fixed loopback URLs

### Requirement: Preserve application boundaries
The navigation SHALL be static links. It SHALL NOT send credentials or private runtime data, alter the Hub asset allowlist or CSP, frame the dashboard, or change the wall map's origin and CSRF protections.

#### Scenario: Follow a local destination
- **WHEN** a reader activates the B.U.N.N.Y. or Wall link from a document
- **THEN** the browser navigates to the fixed numeric-loopback address without a token, query or fragment in the link
