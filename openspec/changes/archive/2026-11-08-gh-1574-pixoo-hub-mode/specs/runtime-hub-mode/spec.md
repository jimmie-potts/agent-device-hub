## MODIFIED Requirements

### Requirement: Fixed independent fan-out

After a successful global save, the core SHALL dispatch exactly one tracked `device-mode-set` for each device of a qualified admitted Nanoleaf or Pixoo module, using the shared Hub-mode table, which maps Work, Free and Quiet one to one for both kinds. After an individual save it SHALL dispatch only to the selected participant, using that same table. Stopped or failed admitted modules SHALL remain participants. Refused modules and other device kinds SHALL NOT participate. A participant failure SHALL NOT prevent other participants from being dispatched or completing. Their failed and uncertain operations SHALL use the shared inbox.

#### Scenario: Mixed results
- **WHEN** Work is saved and one device fails while the other succeeds
- **THEN** Work remains the saved choice, both commands were independently tracked, and the failure appears in the shared inbox without changing the successful result

#### Scenario: Participant admission
- **WHEN** one admitted Nanoleaf module is stopped and a Pixoo module was refused
- **THEN** the Nanoleaf device remains a target and the refused Pixoo module is excluded
