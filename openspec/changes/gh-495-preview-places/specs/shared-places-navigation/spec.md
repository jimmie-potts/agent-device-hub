## MODIFIED Requirements

### Requirement: Consistent place identity and order
Every Hub-owned guide, architecture viewer, atlas, reference and dashboard entry point SHALL identify its current place and present Guide, Architecture, Atlas, Reference, B.U.N.N.Y. and Wall in that order with those labels. The only exception is a Local place that a verification preview's dashboard omits under the public and local destinations requirement. A place other than the current one SHALL be one link away.

#### Scenario: Move from a document to another place
- **WHEN** a reader opens any generated guide, architecture viewer, atlas or reference page
- **THEN** the Places navigation has the same ordered labels, identifies the current place and links directly to each other place

#### Scenario: Move from the dashboard
- **WHEN** the operator opens the authenticated B.U.N.N.Y. dashboard
- **THEN** its Places group presents the same ordered labels and direct destinations without issuing a controller command

### Requirement: Public and local destinations
The public edition SHALL use public URLs for Guide, Architecture, Atlas and Reference. B.U.N.N.Y. and Wall SHALL use only their numeric-loopback URLs and be visibly tagged Local. The public pages SHALL work without a local service, credential or private path; the local links MAY be unavailable on a phone. A Hub configured with preview place links SHALL link each configured Local place to its configured numeric-loopback URL. Its dashboard SHALL omit every other Local destination except the current B.U.N.N.Y. place, so a verification preview never links to an installed service. A Hub without preview place links SHALL keep the fixed loopback destinations.

#### Scenario: Read on a phone
- **WHEN** a reader opens the public edition at 390 px viewport width
- **THEN** the four public destinations open, the two loopback destinations say Local and the Places navigation has no horizontal overflow

#### Scenario: Export the public edition
- **WHEN** the reviewed source is exported for publication
- **THEN** every exported guide, architecture, atlas and reference entry page contains the same navigation with public document URLs and only the two fixed loopback URLs

#### Scenario: Open an integrated preview
- **WHEN** the owner opens the dashboard of a Hub whose preview place links name Wall with a paired wall run's loopback URL
- **THEN** the Places Wall link, tagged Local, opens that run's URL and not `127.0.0.1:8765`, and the four public destinations are unchanged

#### Scenario: Open a Hub-only preview
- **WHEN** the owner opens the dashboard of a Hub whose preview place links name no Local place
- **THEN** the Places navigation shows Guide, Architecture, Atlas, Reference and the current B.U.N.N.Y. place, and has no Wall link

#### Scenario: Refuse an unsafe preview link
- **WHEN** a Hub configuration names a preview place link that is not a credential-free numeric-loopback HTTP URL without query or fragment, or that names B.U.N.N.Y.
- **THEN** the Hub refuses to start with a stable configuration error and no dashboard serves the link

### Requirement: Preserve application boundaries
The navigation SHALL be static links, except that a verification preview's Local destinations come from its Hub's private configuration through the authenticated dashboard context. It SHALL NOT send credentials or private runtime data, alter the Hub asset allowlist or CSP, frame the dashboard, or change the wall map's origin and CSRF protections.

#### Scenario: Follow a local destination
- **WHEN** a reader activates the B.U.N.N.Y. or Wall link from a document
- **THEN** the browser navigates to the fixed numeric-loopback address without a token, query or fragment in the link

#### Scenario: Follow a preview's local destination
- **WHEN** the owner activates a preview dashboard's Wall link
- **THEN** the browser navigates to the paired run's numeric-loopback address without a token, query or fragment, and the Hub serves no new asset route and keeps its CSP
