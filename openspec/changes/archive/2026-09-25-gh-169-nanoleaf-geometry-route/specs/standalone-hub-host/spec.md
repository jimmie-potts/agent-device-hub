## ADDED Requirements

### Requirement: Read-only Nanoleaf geometry route
For a `nanoleaf` controller, the host SHALL serve `GET /api/controllers/v1/<alias>/integration/geometry` after the same authorization and read scope as the other integration reads. It SHALL read the owner's read-only `GET /controller/integration/v1/geometry` for the configured device through the same bounded per-device client with the native credential, and SHALL return only a response that passes exact validation against the owner's geometry contract and whose controller and device identity match the configuration; any other response SHALL answer `incompatible-controller`. An owner without the route SHALL answer 422 `unsupported-capability` without marking the controller unavailable. Other kinds SHALL answer 422 without contacting the owner. The route SHALL accept no query string or write, and SHALL NOT change the settings snapshot or controller v1. Maps to [codex-nanoleaf#169](https://github.com/jimmie-potts/codex-nanoleaf/issues/169)'s hub consumer criterion.

#### Scenario: Reading the Lines and the Panels
- **WHEN** an authorized client reads the geometry route for a Lines alias and a Panels alias
- **THEN** each returns the owner's validated geometry for its own device, and the owner sees only the native credential

#### Scenario: Device without a saved layout
- **WHEN** the owner reports a device with no saved layout
- **THEN** the route returns its explicit empty result unchanged

#### Scenario: Owner that predates the route
- **WHEN** the owner answers the geometry request with 404 `invalid-request`
- **THEN** the route answers 422 `unsupported-capability`, the controller's health is unchanged and its settings snapshot is still served

#### Scenario: Incompatible geometry
- **WHEN** the owner returns geometry with an extra key, a malformed element or another device's identity
- **THEN** the route answers 502 `incompatible-controller` without passing the response on
