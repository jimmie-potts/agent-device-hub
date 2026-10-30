## MODIFIED Requirements

### Requirement: Honest adoption and evidence boundaries

The contract documentation SHALL inventory owned producer groups, repository owners and proposed seams with unadopted status, and explicitly classify pure/no-op, silent-hook receiver, retired/static and external-tool boundaries. Existing machine protocols, domain receipts and verification proof SHALL retain their separate meaning. Where a producer exports over OTLP, the documentation SHALL name the configuration that enables it, the owned Collector origins it accepts and the issue that records the installed evidence, and SHALL claim no ingestion that a source test did not show (Hub #813).

#### Scenario: Contract delivery is not runtime adoption
- **WHEN** the artifact and fixtures pass source validation
- **THEN** documentation still identifies consumer adoption as pending and claims neither live ingestion, installed coverage nor physical acceptance

#### Scenario: The runtime's export is described, not claimed installed
- **WHEN** the B.U.N.N.Y. runtime's source exports records and spans to an owned Collector under its configuration file's `diagnostics.export.collector`
- **THEN** the contract's ingestion and adoption text names that configuration, the stderr journal that stays unscraped, the loss summary and the issue holding the installed evidence, and states no installed ingestion of its own
