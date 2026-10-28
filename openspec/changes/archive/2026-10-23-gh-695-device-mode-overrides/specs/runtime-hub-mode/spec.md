## MODIFIED Requirements

### Requirement: One durable selection

The core SHALL own one `mode/2.1` record for `hub`, initially Free with no overrides. It SHALL retain the global fields and accept the earlier `mode/2.0` contract. It SHALL persist an explicit valid authorized global or individual selection, its shared revision comparison and its successful core completion in one transaction before dispatching device commands. The selected modes SHALL describe saved choices, independently of device success.

#### Scenario: First start and restart
- **WHEN** a new runtime starts, then restarts after selecting Quiet
- **THEN** its selection is initially Free and later Quiet, and neither start sends a device command

#### Scenario: Refused selection
- **WHEN** a selection is invalid, unauthorized, stale or cannot commit
- **THEN** the prior selection remains and no device command is sent

#### Scenario: Existing store
- **WHEN** a valid earlier store without overrides is opened
- **THEN** its choice and revision remain, with no exceptions and no commands; a corrupt existing record is refused without replacing it with Free

### Requirement: Fixed independent fan-out

After a successful global save, the core SHALL dispatch exactly one tracked `device-mode-set` for each device of a qualified admitted Nanoleaf or Pixoo module, using the existing Hub-mode mapping. After an individual save it SHALL dispatch only to the selected participant, using that same mapping. Stopped or failed admitted modules SHALL remain participants. Refused modules and other device kinds SHALL NOT participate. A participant failure SHALL NOT prevent other participants from being dispatched or completing. Their failed and uncertain operations SHALL use the shared inbox.

#### Scenario: Mixed results
- **WHEN** Work is saved and one device fails while the other succeeds
- **THEN** Work remains the saved choice, both commands were independently tracked, and the failure appears in the shared inbox without changing the successful result

#### Scenario: Participant admission
- **WHEN** one admitted Nanoleaf module is stopped and a Pixoo module was refused
- **THEN** the Nanoleaf device remains a target and the refused Pixoo module is excluded

## ADDED Requirements

### Requirement: Individual saved choice

An authenticated control caller SHALL be able to select Work, Free or Quiet for one admitted Nanoleaf or Pixoo participant through HTTP or MCP. Its saved override SHALL survive restart. Choosing the Hub mode individually SHALL clear only that target's override. Every new global selection SHALL clear all overrides, including same-mode reapply. A global selection with no participants SHALL save normally without device commands. Missing or unqualified individual targets SHALL be refused; offline admitted targets SHALL retain saved intent and independently report failure.

#### Scenario: One exception and reset
- **WHEN** Hub Work is followed by individual Nanoleaf Free, then individual Work
- **THEN** only Nanoleaf is commanded by each individual request, the Hub and Pixoo choices remain Work, and the individual Work request removes the exception

#### Scenario: Global reapply
- **WHEN** the owner explicitly selects the current Hub mode with a new request ID
- **THEN** every saved exception is cleared and participants are independently requested; a duplicate request clears or sends nothing again

#### Scenario: Empty and unavailable participation
- **WHEN** a global selection has no participants, or an individual selection addresses an unqualified target
- **THEN** the global choice saves without commands, while the individual request refuses without changing any saved choice

#### Scenario: Offline participant
- **WHEN** a configured participant cannot receive an admitted individual command
- **THEN** the saved override remains and the existing result/inbox records show failure or uncertainty

### Requirement: Bounded conflicting selections

Global and individual selections SHALL share one bounded busy guard while selection or its device requests remain pending. Conflicting requests SHALL refuse without changing saved intent or issuing device commands. Existing tracker deadlines SHALL bound pending work; no queue, automatic retry or rollback is added. Late results SHALL never mutate saved choices.

#### Scenario: Overlap and recovery
- **WHEN** an individual request overlaps a pending global application
- **THEN** it refuses as busy without changing choices; after the earlier bounded work settles, a new explicit request can proceed

#### Scenario: Lost reply and late result
- **WHEN** a client loses its selection reply and later reads state/results, or an older device result arrives after a newer choice
- **THEN** reads send nothing and the newer choice remains; request identity prevents automatic or duplicate replay

### Requirement: Existing cards with compact inspection

The dashboard SHALL extend the existing reusable Hub, lighting and Pixoo cards with their current styles, artwork and interaction patterns. Individual Work/Free/Quiet choices SHALL be edited on the corresponding device controls. The Hub card SHALL keep a neutral collapsed exception summary with links to those controls; failures SHALL retain the existing Check Inbox behavior. Saved choice, requested native state, fresh evidence, stale/unknown state and outcome SHALL remain distinguishable. Disclosure, navigation and native observations SHALL send no mode selection. Power, brightness, scene and media controls SHALL retain their meaning.

#### Scenario: Inspect without changing devices
- **WHEN** Hub Work has one individual Free override and the owner expands the summary or opens its device controls
- **THEN** the existing Hub face remains compact when collapsed, the exception names that device and its choice, and inspection sends no command

#### Scenario: Shared placements and access
- **WHEN** the owner uses individual mode controls on Home or the device's existing page, including with a keyboard and at phone width
- **THEN** the same saved choice and guard behavior appear; read-only/stale callers cannot change it and unknown device evidence is never presented as a confirmed mismatch

### Requirement: One effective-choice interface

Consumers SHALL read an individual's override or fall back to the Hub selection through the same versioned record. Missing or stale evidence SHALL remain unavailable, never default Free permission. This delivery SHALL test a synthetic consumer without adding actual companion behavior or another store.

#### Scenario: Consumer fallback and reset
- **WHEN** a synthetic consumer reads a fresh record with and without its override, after global reset or restart, and then reads unavailable/stale state
- **THEN** it obtains the saved effective choice for fresh state and no permission from unavailable/stale state; no read starts output
