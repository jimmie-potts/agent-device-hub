## Why

Device consumers need one lifecycle vocabulary without inheriting Nanoleaf's Codex-specific read-state assumptions. [Hub #2](https://github.com/jimmie-potts/agent-device-hub/issues/2) qualifies the provider evidence and supplies a versioned contract before the shared reducer and Pixoo adoption begin.

## What Changes

- Record installed artifact versions and primary-source capabilities for Codex Desktop, Codex CLI and Claude Code on Windows/WSL, with explicit live-client gaps and stop conditions.
- Add a strict, bounded metadata schema, TypeScript/Python validation consumers and shared fixtures covering identity, independent evidence dimensions, privacy and compatibility.
- Define deduplication fallback, observation clock boundaries and observational fail-open delivery requirements. Runtime emitters and numeric performance budgets remain in their owning issues.
- Package schemas, fixtures and validators for immutable downstream adoption; maintain the Hub work guide without repairing the reserved #73 rendering defect.

## Capabilities

### New Capabilities

- `agent-lifecycle-contract`: Qualified lifecycle metadata and portable validation with explicit evidence and compatibility boundaries.

### Modified Capabilities

None. The controller-contracts and shared-mcp-gateway wire contracts remain unchanged.

## Impact

New shared contract source and documentation in Hub, shared build/test/packaging tooling and CI. [Pixoo #29](https://github.com/jimmie-potts/divoom-app-upgrade/issues/29) adopts only the delivered archive. [Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) measures the qualified paths before [Hub #3](https://github.com/jimmie-potts/agent-device-hub/issues/3) implements the state owner. Preserve [Pixoo's ownership contract](https://github.com/jimmie-potts/divoom-app-upgrade/blob/d51ce01dbe7be66322f58f333465d49f405bdd6d/docs/hub-integration.md) and existing Nanoleaf behavior.

## Delivery assessment

Assessed against the live issue and Hub main `edfb94dcc06f437bd7a53365bd77284a7dcb16c5` on 2026-09-08. Complexity is high because identity, ordering, provider capabilities and downstream policies interact. Uncertainty is high until installed artifacts and primary sources are reconciled; live observation cannot be inferred from documentation. Impact is high because privacy and observational permissions cross provider boundaries. Provider discovery precedes executable implementation; independent Standards and Specification review must cover privacy rejection, uncertainty, language parity and archive consumption. Hosted jobs and guide maintenance remain mandatory. No installed-client sessions, personal changes or device operations are included.
