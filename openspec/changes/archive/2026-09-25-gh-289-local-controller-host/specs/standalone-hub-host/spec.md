## ADDED Requirements

### Requirement: Tidbyt and LIFX controller kinds

The host SHALL accept configured controllers of kind `tidbyt` and `lifx` alongside `pixoo` and `nanoleaf`. It SHALL read their controller v1 snapshots with the configured device ID and route their controller v1 commands through the same bounded per-device client, validating snapshots, receipts and identities as for other kinds. Integration settings routes SHALL answer 422 `unsupported-capability` for these kinds without contacting the controller. For a `lifx` component only, the host SHALL serve `GET /api/controllers/v1/<alias>/lighting/snapshot` and `POST /api/controllers/v1/<alias>/lighting/commands`, which forward to the owner's `lifx-light` profile route after the same authorization as other controller routes. It SHALL forward only strict `lifx-light` 1.0.0 color and temperature requests for the configured controller and device, and SHALL accept only a lighting snapshot and a controller v1 receipt whose identity matches. Any other kind SHALL answer 422 on the lighting routes.

#### Scenario: Registered kinds
- **WHEN** `host.json` registers a `tidbyt` alias and a `lifx` alias with loopback `/controller/v1` endpoints and tokens
- **THEN** the hub starts, lists both components with their kinds, and reads and commands them through their own bounded clients

#### Scenario: Owner rejection passes through
- **WHEN** a client sends a controller v1 command that the Tidbyt owner does not support
- **THEN** the hub returns the owner's 422 `unsupported-capability` receipt unchanged and sends nothing else

#### Scenario: Lighting profile routing
- **WHEN** an authorized client posts a valid `lifx.color.set` for a `lifx` alias
- **THEN** the hub forwards exactly that request to the owner's profile route and returns its receipt, and the same request to a `tidbyt`, `pixoo` or `nanoleaf` alias answers 422 without contacting its controller

#### Scenario: Malformed or mismatched lighting data
- **WHEN** a lighting request has an unknown field, a wrong profile or out-of-range value, or the owner returns a lighting snapshot or receipt for another device
- **THEN** the hub rejects the request with 400 before contacting the owner, or treats the response as incompatible or uncertain, without retrying
