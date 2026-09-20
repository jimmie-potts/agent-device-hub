# agent-provider-emitters Specification

## Purpose

Normalize documented provider observations into private lifecycle metadata and deliver them with finite resource use while preserving agent execution.

## Requirements

### Requirement: Qualified metadata mappings
Source adapters SHALL map documented Codex and Claude events using explicit source installation configuration. Child events MUST retain child and evidenced parent identities. Missing turn/order/correlation MUST remain unknown. Unsupported client paths MUST remain disabled until their separate installed qualification.

#### Scenario: Provider normalization
- **WHEN** a supported event supplies a valid session ID and optional qualified turn or child ID
- **THEN** the adapter creates only the corresponding lifecycle observation, a configured source identity and one observation timestamp, without copying the provider payload

#### Scenario: Unknown coverage
- **WHEN** Claude interruption, unqualified continuing-input semantics or Desktop read/hook evidence is requested
- **THEN** the adapter does not invent that evidence or enable an unqualified installed path

### Requirement: Silent bounded fail-open delivery
Emitters SHALL have finite input, output, queue and lifetime bounds derived from the frozen early #30 budget. Failure MUST leave agent permissions unchanged, emit no stdout/stderr/context/wakeup output, avoid retries and device commands, and terminate within the 3,000 ms hard deadline. Disabled emitters MUST perform no delivery.

#### Scenario: Collector outage and saturation
- **WHEN** delivery stalls, rejects, times out or the producer reaches capacity
- **THEN** the emitter returns successfully within its bound, retains only a bounded content-free loss indicator and does not grow an unbounded queue

#### Scenario: Privacy before transport
- **WHEN** raw input contains private canaries beside valid lifecycle identifiers
- **THEN** only explicitly selected metadata is serialized, with no private input in transport, diagnostics, persistence or errors

#### Scenario: Device and UI independence
- **WHEN** the browser is closed or a device is unavailable or in Media/Free mode
- **THEN** observation delivery has no device/UI dependency and issues no device command
