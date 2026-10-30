## MODIFIED Requirements

### Requirement: Explicit compatible host construction
The artifact SHALL offer explicitly constructed Node and Python host diagnostics while preserving the existing pure/browser contract and schema profiles. Module import SHALL NOT start exporters or background work. Enabled tracing SHALL default to 10% head sampling; export SHALL require an explicit owned Collector origin: an `http` origin whose host is a numeric loopback address (`127.0.0.1`, `[::1]`) or `host.docker.internal`, the name Docker Desktop gives a container for its host's own loopback (Hub #813), with no path, credentials, query or fragment. A DNS name, a LAN or device address or any other host SHALL be refused by both runtimes before any network work. This supports #730's package and enablement criteria.

#### Scenario: Disabled and pure consumers
- **WHEN** a host leaves diagnostics disabled or imports only pure helpers
- **THEN** no SDK/exporter, queue thread or network operation starts and existing output is unchanged

#### Scenario: Packaged enabled consumer
- **WHEN** an isolated Node or Python consumer enables diagnostics using the checksum-verified archive
- **THEN** canonical local records and configured OTLP output have the shared resource, scope, operation, outcome and available trace identity

#### Scenario: Owned Collector origins
- **WHEN** a Node host and the Python helper are given `http://127.0.0.1:4318`, `http://[::1]:4318` and `http://host.docker.internal:4318`, and then `http://localhost:4318`, a LAN address, a service name, an origin with user information and an origin with a path
- **THEN** the first three are accepted and the rest refused before any network work, in both runtimes
