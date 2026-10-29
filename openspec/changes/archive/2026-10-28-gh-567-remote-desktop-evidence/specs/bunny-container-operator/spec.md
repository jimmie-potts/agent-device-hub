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
The profile SHALL admit a configuration section only for a shipped module that
declares no device simulation, or whose registration says of that section that it
reaches no local device or file (`hostLocal`, Hub #567), and only without a `secrets`
member and with a section for each module it starts after. It SHALL start the core and each admitted
module that has a section, in shipped order. Startup SHALL refuse a section for
any other module, and an admitted module whose accepted configuration names a device. Each refusal uses the fixed refusal, which repeats
no configured value.

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

#### Scenario: Admitted non-device module
- **WHEN** the owner adds a section for a shipped module that declares no device simulation to the private configuration
- **THEN** startup runs the core and that module with device control still disabled, and health lists the module

#### Scenario: Admitted remote-only Codex Desktop section
- **WHEN** the owner adds a `codex-desktop` section whose sources are all remote, with no `home`
- **THEN** startup runs the core and the module with device control still disabled and no local file read, and a section with any `home` is refused with the fixed refusal

#### Scenario: Refused module section
- **WHEN** the configuration has a section for a module that declares a device simulation and does not call it host-local, for an unknown module, with a `secrets` member, or for a module that starts after one without a section, or an admitted module's accepted configuration names a device
- **THEN** startup refuses with the fixed refusal before state effects, and the configuration file and volumes are unchanged

#### Scenario: Admitted module that fails to start
- **WHEN** an admitted module refuses its section or fails to start
- **THEN** the core and the other modules keep running, and health shows that module `refused` or `failed`
