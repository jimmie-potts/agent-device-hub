## ADDED Requirements

### Requirement: Direct private Conversation controls

For an explicit request by the authorized owner in private Conversation, each companion SHALL execute the resolved supported Hub or device control through the tracked dispatcher without an approval turn. Before dispatch the module SHALL bind the owner input, action, targets, settings, request identity and current revisions. The module SHALL ask for missing or ambiguous details before sending anything. Previous messages MAY resolve references and SHALL NOT authorize a new action. Status questions, hypotheticals and model suggestions SHALL NOT dispatch controls. The dispatcher and designated writer SHALL preserve capability, permission, revision and hold checks. A lost acknowledgment SHALL report uncertainty with no retry.

#### Scenario: All three companions can execute

- **WHEN** the owner names a unique configured plug and asks to turn it off, or asks for an explicit Hub mode, in any of the three conversations
- **THEN** its allowed control dispatches once without an approval question

#### Scenario: Clarification binds a missing setting

- **WHEN** the owner requests a control without specifying a required setting, or names a target matching two devices
- **THEN** Conversation asks for the missing setting or the exact device
- **AND** the owner's answer completes the original request and one tracked command dispatches without another approval

#### Scenario: Matching words alone do not authorize effects

- **WHEN** a model requests brightness using a number the owner supplied for a different property or a relative change
- **THEN** no brightness command is sent
- **AND** a saved-art show must match every requested recipient and the requested status visibility

#### Scenario: A stored admission has no reply after restart

- **WHEN** the runtime restarts after admitting the command but before receiving its reply
- **THEN** the original request stays uncertain and is never sent again

### Requirement: Field grants at each Conversation destination

Before disclosing retained fields, the owning module SHALL check the current grant for caller, companion, purpose, source and destination. This SHALL cover discovery, counts, joins, pages, tool output, provider prompts, recent context, title requests and coding briefs. Existing collection and sharing choices SHALL remain in force. A new destination SHALL receive retained fields only after an explicit owner selection. Revocation SHALL apply before the next disclosure.

#### Scenario: No access through a different read

- **WHEN** the owner withdraws a grant for a retained record
- **THEN** a later read cannot return the record, its fields or its contribution to counts through a different companion, task, tool, page or ungranted destination

#### Scenario: Revocation follows saved answers and selected briefs

- **WHEN** a later turn repeats an earlier tool-derived answer and the owner revokes its source field
- **THEN** the derived answer cannot reach a page, a new model prompt or read-aloud delivery after restart
- **AND** an approved brief with a source denied to the worker does not leave through a new or queued dispatch
- **AND** a retained question cannot expose an answer whose own message grant was revoked

## MODIFIED Requirements

### Requirement: Permitted tools from the runtime

The companions module SHALL discover the tools a turn may call from its own static catalog and filter them by the private section's allowlist, checking membership again when a call executes, so a changed section cannot widen an effect. The built-in owner question is always available; the synthetic fixture read exists only for the synthetic provider. The device tools SHALL use admitted LIFX device records and the registered power and brightness commands. `read_sessions` SHALL read each session through the contracts package's shared session read function and report its shared status class and detail. All three profiles SHALL offer the same configured tools with the same execution checks ([Hub #2106](https://github.com/jimmie-potts/agent-device-hub/issues/2106)). The dashboard SHALL show allowed and unavailable tools for the open profile. Tool availability SHALL grant no access to fields at an ungranted destination. `delegate_coding` SHALL propose handing one bounded coding task, named by an allowlisted repository and a brief, to the coding worker; without a connected worker, or with an unusable repository name or brief, the call SHALL be refused as a tool result and nothing proposed.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, status class and detail, work confirmation and attention from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

#### Scenario: Delegation without a worker
- **WHEN** the model calls `delegate_coding` while no coding worker endpoint is available
- **THEN** the call ends as a tool result saying no worker is connected, no proposal is made and the owner is not asked

#### Scenario: Companion tool scope
- **WHEN** the allowlist names `read_sessions`, a device tool and a catalog tool, and Reachy, MicroDuck and B.U.N.N.Y. each run a turn on the configured model
- **THEN** all three companions' turns offer the listed tools and Details shows the same list

### Requirement: Owner approval of proposed commands

Coding hand-offs and paid generation SHALL use the owner approval interrupt. Approval SHALL bind the exact target, settings and applicable revision. The coding endpoint revision SHALL move when an endpoint is selected, disabled or lost. Running or completing work SHALL retain that revision. A delegation SHALL be proposed while a coding worker is connected, even when the asking companion's slot is busy. The owner SHALL answer an approval only with the literal decisions approve or decline. An approved command SHALL be dispatched once through the core's tracked dispatcher; a dispatch whose bound revision has moved SHALL be refused and reported to the model as refused; a decline SHALL send nothing and say so. An approved delegation SHALL leave the task waiting on a delegation that only the worker's result answers, whether it was sent at once or waits for its companion's busy slot, in which case the tool result SHALL say the coding worker is busy and the hand-off waits for that companion's slot, the conversation SHALL say it waits to delegate, and say it was delegated once the hand-off is sent; the owner's input SHALL be refused for it, it SHALL count no owner question, and cancelling the task SHALL ask the worker to stop or, for a hand-off still waiting, remove it unsent.

#### Scenario: Approved mode change
- **WHEN** the authorized owner explicitly asks for a specific mode and the bound Hub revision still matches
- **THEN** one tracked operation carries the bound revision and the turn presents its actual result without an approval question

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the coding worker's endpoint changed
- **THEN** no command is sent for a decline; a stale approval is refused with `revision-conflict` and the conversation reports it; neither path starts a duplicate command

#### Scenario: Another companion's run
- **WHEN** a delegation is proposed in one conversation and another companion's hand-off starts or ends before the owner approves it
- **THEN** the approval is not refused and the hand-off is sent or waits by its own companion's slot

#### Scenario: Approval after restart
- **WHEN** the runtime restarts while an approval question is waiting
- **THEN** the same question, proposal and recorded revision remain readable, and the explicit answer applies once to that proposal only

#### Scenario: Delegation answered by the worker
- **WHEN** an approved delegation is accepted and the worker later reports its result
- **THEN** the task resumes with that result as the tool's result, the next turn reports it, and an owner answer sent meanwhile is refused as invalid state

#### Scenario: Delegation that waits for a busy slot
- **WHEN** the owner approves a delegation while the companion's slot is busy
- **THEN** the tool result says the coding worker is busy and the hand-off waits for that slot, the conversation says it waits to delegate and then that it delegated once the hand-off is sent, the title check for an accepted hand-off runs once, and no reply says no coding worker is connected

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an owner-requested `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` for another source, or `invalid-message` for a family, target or value its closed schema rejects, records no operation and sends nothing

### Requirement: Conversation controls configured LIFX lights

Conversation SHALL expose authorized LIFX status, power, and brightness based on the admitted owner's current device records. It SHALL ask the owner to disambiguate matching labels before sending a write. Reads report observed values with evidence time and identify unknown or unavailable evidence. A reading older than the LIFX refresh interval, dated in the future, or superseded by a newer transmission SHALL be reported as stale.

#### Scenario: Status from the configured owner
- **WHEN** the owner asks about a configured LIFX light
- **THEN** Conversation names the light and reports the observed power and brightness or explains that the evidence is unavailable

#### Scenario: Exact target and guarded effect
- **WHEN** the owner explicitly requests a specific power or brightness setting
- **THEN** one tracked command targets the selected eligible bulb with the saved guards, and Conversation reports the operation without claiming a physical effect from acceptance

#### Scenario: Approval can no longer execute
- **WHEN** the target becomes unavailable before owner admission, permission is removed, or the saved guards become stale
- **THEN** the request cannot cause a device write and Conversation reports the refusal

#### Scenario: Lost reply
- **WHEN** the assistant loses the reply after possible admission
- **THEN** it reports uncertainty and restart never repeats the command

### Requirement: Tracked owner approval across device integrations

Conversation SHALL resolve one exact action on a selected device or explicit set of recipients. Admission SHALL bind the owner, target, effect, and the domain revision, generation or exact immutable library version required at admission. The SDK and core dispatcher SHALL carry the existing typed commands to their respective owners. The original owner input and request identity SHALL persist across failures. A lost reply SHALL remain uncertain without an automatic resend. Multi-target actions SHALL present each target's effect evidence independently.

#### Scenario: Wemo respects its device policy

- **WHEN** the owner explicitly requests power on or off for an eligible Wemo plug identified by name
- **THEN** the existing Wemo command runs through that plug's queue with its hold and revision checks
- **AND** the original continuous run and maximum-on policy remain effective

#### Scenario: A saved artwork is presented

- **WHEN** the owner requests the saved artwork on exact display recipients
- **THEN** the existing art-show path prepares and presents it and Conversation exposes each display's tracked result, including skipped or uncertain effects

#### Scenario: Availability or approval changes

- **WHEN** a held target, revoked permission, stale revision, or changed generation invalidates a resolved write
- **THEN** the refusal is visible without starting a device effect

### Requirement: Light-show authoring and playback in Conversation

Conversation SHALL let the owner create a deterministic draft, edit its cues, and preview a storyboard through the existing authoring rules. Draft and preview operations SHALL send no lighting command. Saving SHALL use the existing guarded catalog operation and retain prior versions. Playing SHALL require an explicit request for the exact saved version and eligible light. Stopping SHALL require an explicit request for the active generation and preserve the owner's restoration behavior. [#724](https://github.com/jimmie-potts/agent-device-hub/issues/724) owns AI-generated drafts.

#### Scenario: Create, edit, preview and save

- **WHEN** the owner creates a draft, specifies a cue edit, previews it and explicitly saves
- **THEN** the storyboard shows the edited cue and the explicit save creates one independently selectable version
- **AND** no lighting command was sent

#### Scenario: Play a saved version and stop it

- **WHEN** the owner requests a saved show version on an eligible light and later requests Stop
- **THEN** the existing playback owner runs that immutable version on the selected light and stops the selected generation

#### Scenario: Unsaved or stale selection

- **WHEN** the owner requests playback of an unsaved draft or a request no longer matches the selected light, saved version or generation
- **THEN** Conversation reports the refusal and no playback starts from that request

### Requirement: Resolve exact artwork and display before Conversation approval

Conversation SHALL resolve the requested artwork and configured display identities before executing a display action. It SHALL distinguish a browser composition from the browser destination and a device kind from its routing ID. Each destination SHALL be eligible for the exact artwork and visibly identified. Conversation SHALL explain unavailable choices and require a specific choice among ambiguous matches.

#### Scenario: A display kind matches more than one installation target

- **WHEN** the owner asks for a display by kind and two configured displays could match
- **THEN** Conversation asks which display to use and dispatches nothing before an exact selection

#### Scenario: Generate for the reply and show on a display

- **WHEN** the owner approves generation for a request that also names a configured display, and the exact generated attachment becomes ready
- **THEN** the reply presents that attachment and offers the Show on control with the intended destination selected, even if another artwork has been created since

#### Scenario: Select a destination for a ready attachment

- **WHEN** the owner opens Show on for a saved attachment
- **THEN** available choices refer to that same artwork, incompatible or unavailable choices identify the reason, and a confirmed show reports preparation and presentation evidence for each chosen destination

#### Scenario: A proposed show is dismissed or interrupted

- **WHEN** the owner dismisses the display choice, reloads the page or reconnects after an uncertain dispatch
- **THEN** Conversation performs no automatic generation or display write and restores the tracked preparation and presentation evidence for each selected destination, including uncertainty after a lost reply

### Requirement: Closing reply when a turn fails

An admitted turn that settles failed or uncertain SHALL save a single private closing reply explaining the known outcomes of its recorded actions and the supported reason the turn stopped. The runtime SHALL use the records of that turn, preserve a provider's existing closing answer, and issue no model call, device command or retry to produce or deliver the fallback. If the cause is unknown, the fallback SHALL say so. Pending questions and paused tasks SHALL retain their controls.

#### Scenario: A failed command follows a successful step

- **WHEN** a turn has saved action evidence and a later requested action is refused, then the model cannot finish the turn
- **THEN** the closing reply describes both outcomes using the strongest recorded evidence, preserves confirmed phases across later reads with missing records, and remains readable after reload

#### Scenario: Recovery finds an uncertain call

- **WHEN** recovery settles a turn with an unresolved receipt and later receives evidence
- **THEN** the saved reply identifies uncertainty, recovery and late evidence produce no second answer or device write, and explicit continuation follows the existing recovery rules

#### Scenario: No diagnosis or proposal

- **WHEN** a read-only task or an answered clarification ends before a proposal or final explanation
- **THEN** the owner sees where the turn stopped, including a specific known limit when available, and the fallback makes no claim about the requested diagnosis

### Requirement: Approved device confirmation in Conversation

Conversation SHALL associate the Pixoo brightness request with its original task, turn, owner and target. It SHALL report the strongest correlated evidence available at turn end and recover a pending confirmation through SDK sync without reissuing the write.

#### Scenario: The display reports before the deadline

- **WHEN** the selected display reports fresh brightness for the tracked request within the turn's observation window
- **THEN** the original reply states the percentage the display reported, including a different or already-matching value
- **AND** the turn ends once and any resolved clarification clears its attention item

#### Scenario: The display reports after the turn ends

- **WHEN** the original reply says confirmation is pending and correlated evidence becomes available later
- **THEN** one update appears on the original exchange, including after restart or duplicate delivery
- **AND** the original reply and its notice remain intact

#### Scenario: No reading can confirm the request

- **WHEN** readback is unavailable or only an unrelated reading exists
- **THEN** Conversation preserves any acknowledgment and reports the remaining uncertainty or lack of confirmation

### Requirement: Approved Wemo power confirmation

Conversation SHALL use the configured plug and exact on or off setting in the request. It SHALL follow the tracked operation and report a fresh power reading in the original reply or once as a later update to that reply.

#### Scenario: Readback arrives after the original reply

- **WHEN** the owner sees a pending reply and the selected plug reports its power later
- **THEN** the original exchange receives one update, including after reconnect or restart
- **AND** no write or turn-end notice is repeated

#### Scenario: The write is uncertain

- **WHEN** the plug's write reply was lost
- **THEN** Conversation describes the uncertainty and hold and does not confirm the requested power from a later ordinary poll
