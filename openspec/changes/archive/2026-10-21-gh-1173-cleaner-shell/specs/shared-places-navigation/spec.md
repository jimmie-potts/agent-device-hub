## MODIFIED Requirements

### Requirement: Consistent place identity and order

Every Hub-owned architecture viewer, atlas, reference and dashboard entry point SHALL identify its current place and present Architecture, Atlas, Reference, B.U.N.N.Y. and Wall in that order with those labels. The only omission is a Local place that a verification preview's dashboard omits under the public and local destinations requirement. In the current runtime dashboard, the unchanged Places group SHALL appear within Settings, whose utility link is reachable from every page. Retained legacy applications and documentation viewers SHALL keep their existing Places presentation. Each presented non-current place SHALL remain a direct link to its destination.

#### Scenario: Move from a document to another place
- **WHEN** a reader opens any generated architecture viewer, atlas or reference page
- **THEN** the Places navigation has the same ordered labels, identifies the current place and links directly to each other place

#### Scenario: Move from the dashboard
- **WHEN** the operator opens Settings in the authenticated current B.U.N.N.Y. dashboard
- **THEN** its Places group presents the same ordered labels and direct destinations without issuing a controller command
