## MODIFIED Requirements

### Requirement: Permitted tools from the runtime

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. The device tools SHALL use admitted LIFX device records and the registered power and brightness commands. `read_sessions` SHALL read each session through the contracts package's shared session read function and report its shared status class and detail. The dashboard SHALL show allowed and unavailable tools and grant nothing. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, status class and detail, work confirmation and attention from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

### Requirement: Owner approval of proposed commands

Every state-changing command SHALL go through the existing question interrupt as an approval proposal bound to the exact family, target, value and the revision it was proposed against: the synced Hub-mode revision for `mode-set`, the coding state revision for a delegation, and the configuration revision and generation for each LIFX write. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved delegation SHALL leave the task waiting on a delegation that only the worker's result answers; the owner's input SHALL be refused for it, it SHALL count no owner question, and cancelling the task SHALL ask the worker to stop.

#### Scenario: Approved mode change
- **WHEN** the owner approves a proposed `set_mode` and the Hub mode has not changed since the proposal
- **THEN** one tracked `mode-set` operation is sent with the recorded expected revision, the saved mode changes, and the task's final text reports the accepted result without claiming device effects

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the Hub mode or the coding worker's state changed
- **THEN** no command is sent for a decline; a stale approval is refused with `revision-conflict` and the conversation reports it; neither path starts a duplicate command

#### Scenario: Approval after restart
- **WHEN** the runtime restarts while an approval question is waiting
- **THEN** the same question, proposal and recorded revision remain readable, and the explicit answer applies once to that proposal only

#### Scenario: Delegation answered by the worker
- **WHEN** an approved delegation is accepted and the worker later reports its result
- **THEN** the task resumes with that result as the tool's result, the next turn reports it, and an owner answer sent meanwhile is refused as invalid state

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an approved `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` for another source, or `invalid-message` for a family, target or value its closed schema rejects, records no operation and sends nothing

## ADDED Requirements

### Requirement: Conversation controls configured LIFX lights

Conversation SHALL expose authorized LIFX status, power, and brightness based on the admitted owner's current device records. It SHALL ask the owner to disambiguate matching labels before proposing a write. Reads report observed values with evidence time and identify unknown or unavailable evidence.

#### Scenario: Status from the configured owner
- **WHEN** the owner asks about a configured LIFX light
- **THEN** Conversation names the light and reports the observed power and brightness or explains that the evidence is unavailable

#### Scenario: Exact target and guarded effect
- **WHEN** the owner approves a specific power or brightness proposal
- **THEN** one tracked command targets the selected eligible bulb with the saved guards, and Conversation reports the operation without claiming a physical effect from acceptance

#### Scenario: Approval can no longer execute
- **WHEN** the target becomes unavailable, permission is removed, or the saved guards become stale
- **THEN** the approval cannot cause a device write and Conversation reports the refusal

#### Scenario: Lost reply
- **WHEN** the assistant loses the reply after possible admission
- **THEN** it reports uncertainty and restart never repeats the command
