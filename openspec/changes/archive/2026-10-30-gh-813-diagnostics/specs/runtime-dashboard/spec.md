## ADDED Requirements

### Requirement: Mac-local diagnostics viewer link on Connections
Connections SHALL show a Diagnostics card that links **Open Grafana · Local** only when the runtime's links (`GET /api/v2/links`, from the configuration file's `edge.placeLinks.grafana`) name a loopback `http` URL for it, exactly as a Local place is shown; without one the card SHALL say that no diagnostics viewer is configured, and while the links load it SHALL show no link. The card SHALL say that the viewer is on this computer's loopback only and is not reachable through the private remote entry, and that a missing record there is a gap, never proof that nothing happened. The dashboard SHALL render no log table, trace view or diagnostic query of its own (Hub #812 deferred, #813).

#### Scenario: A runtime that names the viewer
- **WHEN** a signed-in page opens Connections on a runtime whose links name `grafana` as `http://127.0.0.1:3000/`
- **THEN** the Diagnostics card links **Open Grafana · Local** to that address in a new tab, beside the Connection, Running build, Operator tools and Observed sources cards, and passes the page's accessibility check

#### Scenario: A run that names none
- **WHEN** a disposable run's links name no viewer
- **THEN** the card offers no link and says no diagnostics viewer is configured, so a preview never leads to an installed viewer
