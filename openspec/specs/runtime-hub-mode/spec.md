# runtime-hub-mode Specification

## Purpose

Keep the Hub's selected Work/Free/Quiet mode durable and apply explicit selections through the existing device writers without replay.

## Requirements

### Requirement: One durable selection

The core SHALL own one `mode/2.0` record for `hub`, initially Free. It SHALL persist an explicit valid authorized `mode-set/2.0` request, its revision comparison and its successful core completion in one transaction before dispatching device commands. The selected mode SHALL describe the saved choice, independently of device success.

#### Scenario: First start and restart
- **WHEN** a new runtime starts, then restarts after selecting Quiet
- **THEN** its selection is initially Free and later Quiet, and neither start sends a device command

#### Scenario: Refused selection
- **WHEN** a selection is invalid, unauthorized, stale or cannot commit
- **THEN** the prior selection remains and no device command is sent

### Requirement: Fixed independent fan-out

After a successful save, the core SHALL dispatch exactly one tracked `device-mode-set` for each device of a qualified admitted Nanoleaf or Pixoo module, using the existing Hub-mode mapping. Stopped or failed admitted modules SHALL remain participants. Refused modules and other device kinds SHALL NOT participate. A participant failure SHALL NOT prevent other participants from being dispatched or completing. Their failed and uncertain operations SHALL use the shared inbox.

#### Scenario: Mixed results
- **WHEN** Work is saved and one device fails while the other succeeds
- **THEN** Work remains the saved choice, both commands were independently tracked, and the failure appears in the shared inbox without changing the successful result

#### Scenario: Participant admission
- **WHEN** one admitted Nanoleaf module is stopped and a Pixoo module was refused
- **THEN** the Nanoleaf device remains a target and the refused Pixoo module is excluded

### Requirement: No implicit application or replay

Duplicate request IDs SHALL use the existing dispatcher's deduplication without another save or fan-out. Restart, refresh, reconnect and participant assignment SHALL send no command. Interrupted tracked commands SHALL remain uncertain and SHALL NOT be resent. An explicit same-mode application with a new request ID SHALL be allowed. Native changes SHALL remain observations and SHALL NOT trigger correction.

#### Scenario: Duplicate and explicit reapplication
- **WHEN** the same selection request is submitted twice, then the same mode is explicitly submitted with a new request ID
- **THEN** only the first and third submissions save and dispatch commands

#### Scenario: Interrupted application
- **WHEN** the runtime stops after a command is sent but before its outcome is observed
- **THEN** restart restores the saved selection and the existing tracker resolves the pending command as uncertain without replay

### Requirement: Existing authenticated entry points

The dashboard and MCP SHALL submit explicit selections through the existing dispatcher with ordinary control scope. Mode changes SHALL NOT gain the dedicated operator privilege used for title and notice metadata. A raw SDK command without a matching transaction admission SHALL be refused.

#### Scenario: Read-only and raw request
- **WHEN** a read-only client requests a selection or a raw SDK caller sends a mode command
- **THEN** it is refused, the saved mode is unchanged and no device command is sent
