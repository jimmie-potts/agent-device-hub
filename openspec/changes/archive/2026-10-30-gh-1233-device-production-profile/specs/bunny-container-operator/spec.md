## ADDED Requirements

### Requirement: Explicit production device profile

The container SHALL offer an explicitly selected production profile with device control disabled by default. With control enabled it SHALL admit only explicitly configured shipped modules, in their shipped dependency order, using their existing configuration, private-secret and device contracts. Unknown modules and missing configured dependencies SHALL refuse before state effects. Unconfigured modules SHALL remain inactive. Existing host-local and private-proxy profiles SHALL retain their device-control and named-device refusals.

The production profile SHALL reuse authenticated private-proxy access, host-loopback gateway publication, Host/Origin checks, private state/configuration/secrets volumes and the local writer lease. Secrets SHALL remain canonical references within the existing private secrets directory. Device control SHALL require explicit enablement; disabled production operation SHALL refuse configured devices. Profile admission SHALL NOT qualify physical devices or override existing module refusals, supported models or read-only controls.

The operator SHALL verify the selected profile, control mode, private mounts, gateway binding and dedicated network before and after start. An optional Pixoo hosted-GIF listener SHALL use one explicitly selected private host IPv4 address at TCP 41240, distinct from the gateway. Unexpected listeners, writable dependency mounts and networking privileges SHALL be refused. No ADB server, pairing, account login or automatic cross-host handoff SHALL be created.

#### Scenario: Configured shipped modules start
- **WHEN** the operator explicitly selects production with enabled control and valid sections for shipped household modules
- **THEN** only those modules and the core start in dependency order, existing admitted non-device modules remain available, and invalid or unavailable module dependencies retain their existing honest outcomes

#### Scenario: Safe defaults and retained profiles
- **WHEN** control is omitted, or the host-local/private-proxy profile is selected with enabled control or a named device
- **THEN** device control remains disabled by default and the forbidden configuration refuses without activating a device

#### Scenario: Unsafe production input
- **WHEN** a module is unknown, a required module section is absent, a secret escapes the private secrets directory, mounts or gateway bindings widen, or another state owner holds the lease
- **THEN** startup refuses with the existing fixed refusal family and creates no competing writer or leaked private diagnostic value

#### Scenario: Explicit hosted-GIF access
- **WHEN** the operator selects the optional private IPv4 Pixoo binding matching its configured hosted-GIF origin and listener
- **THEN** only that TCP 41240 binding is added and the dashboard gateway remains host-loopback only, while absent or mismatched listener selection refuses the hosted listener

#### Scenario: Disposable and installed evidence stay separate
- **WHEN** fresh synthetic module state runs with simulated transports in a disposable instance
- **THEN** health reports actual module results without physical requests, while installed image verification keeps control disabled and configures no physical device
