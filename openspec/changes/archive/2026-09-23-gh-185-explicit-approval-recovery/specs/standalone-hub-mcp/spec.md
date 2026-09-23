## ADDED Requirements

### Requirement: Explicit MCP approval recovery
The host MCP SHALL offer approval recovery as a control tool with exact session identity, turn and expected revision. Its description SHALL state that the tool is for an explicit user request, changes monitoring state only and does not grant or deny Codex permission.

#### Scenario: Authorized recovery tool
- **WHEN** an authorized MCP client invokes recovery after reading a current session snapshot
- **THEN** it sends one guarded host command and reports its fixed result without device or provider permission effects
