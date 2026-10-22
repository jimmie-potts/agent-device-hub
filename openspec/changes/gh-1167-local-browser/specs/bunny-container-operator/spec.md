## ADDED Requirements

### Requirement: Explicit trusted-local browser profile

The container SHALL offer an explicit host-local profile with device control
forced disabled, fresh private state/configuration and empty client credentials.
It SHALL retain canonical loopback Host/Origin checks while separating the socket
bind. Docker SHALL expose only host127.0.0.1 TCP18788 to container18788 on a
dedicated internal network with no other container attached. Native and isolated
defaults SHALL remain unchanged. No LAN/remote ingress or automatic restart is added.

#### Scenario: Local browser operation
- **WHEN** the approved new profile is privately provisioned and started
- **THEN** the actual Mac-local browser signs in through the existing trusted-local session flow, renders core views and has healthy core-only operation without API tokens or device modules

#### Scenario: Access or isolation mismatch
- **WHEN** Host/Origin is unwanted, a binding is widened, another network/container is attached, or device control is enabled
- **THEN** admission refuses, unsupported startup has no runtime effects and an isolation failure after startup stops the new owned profile without deleting state

#### Scenario: Fresh private provisioning and maintenance
- **WHEN** the new stopped volumes have the exact seeded config and empty secrets
- **THEN** one-shot preparation publishes only the browser config and empty credentials with private modes; unexpected or partial inputs refuse, and ordinary stopped backup and separate empty restore protections remain in force
