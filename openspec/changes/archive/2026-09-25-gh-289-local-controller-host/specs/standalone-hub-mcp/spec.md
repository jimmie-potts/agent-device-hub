## ADDED Requirements

### Requirement: Kind-bound Tidbyt and LIFX tools

Discovery SHALL list authorized `tidbyt` and `lifx` aliases with their kinds and tool prefixes. A `tidbyt` alias SHALL bind only its status tool. A `lifx` alias SHALL bind its status, power, brightness and lighting status tools, plus color and temperature tools that submit one `lifx-light` 1.0.0 request each with integer hue 0 to 360 and saturation 0 to 100, or kelvin 1500 to 9000. Those tools take their request identity and revision and generation guards from the latest status or lighting status result. Neither kind SHALL bind mode, media or integration tools.

#### Scenario: Discovery lists both
- **WHEN** a principal authorized for a `tidbyt` and a `lifx` alias calls `hub_devices`
- **THEN** both aliases appear with their kinds and tool prefixes, and the tool list has no mode, media or integration tools for them

#### Scenario: LIFX color through MCP
- **WHEN** a control principal calls the LIFX color tool with guards from the lighting status result
- **THEN** exactly one lighting request reaches the owner and the tool returns its receipt, and an ambiguous transport failure reports possible prior effects without a retry
