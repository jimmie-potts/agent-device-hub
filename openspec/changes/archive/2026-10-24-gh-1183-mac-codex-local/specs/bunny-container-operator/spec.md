## MODIFIED Requirements

### Requirement: Explicit trusted-local browser profile

The container SHALL offer an explicit host-local profile with device control
forced disabled and private persistent state/configuration. Client credentials SHALL
remain empty by default; an explicit source selection MAY admit exactly one
matching ingest-only credential with no read, control, admin, role or robot grant.
The native producer SHALL retain the private bearer and the hub only its digest.
It SHALL retain canonical loopback Host/Origin checks while separating the socket
bind. Docker SHALL expose only host127.0.0.1 TCP18788 to container18788 on a
dedicated ordinary bridge with no other container attached and outbound access
permitted. Effective running port publication SHALL match the configured loopback
binding. Native and isolated
defaults SHALL remain unchanged. No LAN/remote ingress or automatic restart is added.

#### Scenario: Local browser operation
- **WHEN** the approved new profile is privately provisioned and started
- **THEN** the actual Mac-local browser signs in through the existing trusted-local session flow, renders core views and has healthy core-only operation without device modules or a browser API token

#### Scenario: Access or isolation mismatch
- **WHEN** Host/Origin is unwanted, a binding is widened, another network/container is attached, or device control is enabled
- **THEN** admission refuses, unsupported startup has no runtime effects and an isolation failure after startup stops the new owned profile without deleting state

#### Scenario: Fresh private provisioning and maintenance
- **WHEN** the new stopped volumes have the exact seeded config and empty secrets
- **THEN** one-shot preparation publishes only the browser config and empty credentials with private modes; unexpected or partial inputs refuse, and ordinary stopped backup and separate empty restore protections remain in force

#### Scenario: Explicit local lifecycle grant
- **WHEN** an operator selects one source-derived ingest source and its matching credential
- **THEN** only that single ingest grant is admitted, existing browser access remains unchanged, and absent selection or additional/wider/mismatched grants refuse before startup effects
