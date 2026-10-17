## MODIFIED Requirements

### Requirement: One Tidbyt module with private cloud configuration

The runtime SHALL host one module, `tidbyt` (module API 1.3), that writes the Tidbyt's status and now-playing tiles through Tidbyt's cloud. Its `configure` SHALL accept a section with an `id`, a routing ID; a `cloudDeviceId` of 1 to 128 letters, digits, underscores or hyphens; an optional `statusInstallation` of letters and digits, `agentdevicehub` by default; an optional `nowPlaying` of `{playback, installation?}`, the routing ID of the `playback` record to show and the card's own installation, `nowplaying` by default and different from the status tile's; and a `secrets` member that names the API key's file as `token`. Any other section SHALL be refused with `invalid-request` and a fixed detail that repeats no value. The module SHALL name `id` as its one device and read the key once, at start. The cloud's device ID and the key SHALL NOT appear in any message, log record, span, error body or health entry.

#### Scenario: A valid section
- **WHEN** the section names `tidbyt`, a cloud device, both installations, the `living-room` playback record and the key's file
- **THEN** the runtime accepts it and the module's device is `tidbyt`; without `statusInstallation` or `nowPlaying.installation` the runner's defaults apply

#### Scenario: Sections the module refuses
- **WHEN** the section adds a member, gives an ID with capitals, a cloud device with a slash, an installation with a hyphen, a now-playing installation equal to the status one or a playback ID that is not a routing ID, or names no `secrets.token`
- **THEN** the module is refused with `invalid-request`, and the detail repeats no value

#### Scenario: No secret anywhere
- **WHEN** the module shows both tiles on the simulated cloud
- **THEN** no published message, log record or span holds the API key or the cloud's device ID, and the simulated cloud received the key from the secret file
