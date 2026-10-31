## MODIFIED Requirements

### Requirement: Bounded single execution

The system SHALL admit at most one unfinished task across profiles and one invocation, with no execution queue. Each task SHALL retain limits of six model calls, four tool calls, two questions, 300 seconds active time and 65,536 usage units, with 16,384 units reserved before each model call; a usage unit is one token reported by a configured provider or one fake unit of the synthetic provider. Model/tool deadlines SHALL be 60/5 seconds and control admission five seconds. Inputs, tool results and serialized working state SHALL be bounded at 4/8/32 KiB. Reservations SHALL precede dispatch and survive restart; unreported usage SHALL remain unknown. Paid calls SHALL occur only through a configured provider; the synthetic provider SHALL make none.

#### Scenario: A limit is exhausted
- **WHEN** another operation would exceed a persisted limit
- **THEN** it is refused before dispatch, including after resume or restart

#### Scenario: Cancellation and late result
- **WHEN** cancellation is durably saved while a call is pending
- **THEN** later steps remain fenced, abort is best effort, and a late result can update evidence but cannot reactivate the task

## REMOVED Requirements

### Requirement: Optional accessible synthetic task panel
**Reason**: The page becomes the B.U.N.N.Y. conversation with approval controls and provider facts; the synthetic path stays as a labelled scenario inside it.
**Migration**: The same page identifier serves the conversation panel below; saved tasks, questions and history remain readable there.

## ADDED Requirements

### Requirement: Configured model provider

The companions module SHALL run every task through one provider behind a tool-capable turn contract: a turn receives the fixed instructions, the task's own transcript, the permitted tool definitions and the current Hub mode, and answers with text, a question for the owner, tool calls or a refusal, plus reported usage or unknown. Without a companions section the provider SHALL be the labelled synthetic one, which makes no network call. A section whose `assistant.provider` is `anthropic` SHALL name the model, the effort and, under the section's `secrets`, the API key file; the module SHALL read the key once at start, never log, publish or store it, and SHALL refuse the section without the secret or with an unsupported provider. The `bunny` profile alone SHALL use the configured provider; other profiles SHALL keep the synthetic provider. The prompt SHALL contain only the owner's typed text, tool definitions, tool results and fixed instructions. A provider refusal, unavailability, rate limit or malformed answer SHALL end the task failed or unavailable with a registry code and no fallback to another model; a lost answer SHALL leave the call uncertain. Public state SHALL carry the provider, model and allowed tool names.

#### Scenario: Synthetic default
- **WHEN** the module starts without a companions section or with one that names no provider
- **THEN** public state shows the synthetic provider, no outbound request is made, and a task completes through the same question, tool and approval path

#### Scenario: Configured hosted provider
- **WHEN** the section names the Anthropic provider, its model and its key secret
- **THEN** a `bunny` task sends one request per model call to the Messages API with that model, the fixed instructions, the transcript and the permitted tools; usage tokens are recorded on the call; and the key appears in no record, state, log or page

#### Scenario: Provider failure
- **WHEN** the provider answers with a refusal, an authentication or rate-limit error, is unreachable or exceeds its deadline
- **THEN** the task ends failed or unavailable with the registry code, or uncertain after a lost answer, no second model is tried, and the dashboard's mode controls keep working

### Requirement: Permitted tools from the runtime

The module SHALL expose to the model only tools derived from the runtime's module manifests and core command families that the private companions section lists, and SHALL check the allowlist again when a tool call executes. The first slice SHALL offer `read_sessions`, a bounded summary of the core's synced session records, and `set_mode`, a proposed `mode-set` command. A tool the model names that is not allowed, unknown or unavailable SHALL produce a refusal result to the model and never an effect. The dashboard SHALL show which tools are allowed and which are unavailable without granting any.

#### Scenario: Read tool
- **WHEN** the model calls `read_sessions`
- **THEN** the result lists current sessions with provider, display label, activity, attention and freshness from the module's synced copy, bounded in size, and no session text beyond the allowed display metadata

#### Scenario: Tool outside the allowlist
- **WHEN** the model calls a tool the section does not list, or the section changes between proposal and execution
- **THEN** the call is refused to the model with no effect, and the task continues or ends truthfully

### Requirement: Owner approval of proposed commands

A tool call that would change state SHALL pause the task with an approval question that names the exact family, target and requested value, and SHALL record the Hub-mode revision current at the proposal. Only an explicit approve answer bound to that question SHALL send the command, with the recorded revision as its expected revision; a decline answer SHALL return a declined result to the model. A command the core refuses, including `revision-conflict` after the mode changed, SHALL be reported to the model and the owner as refused; an uncertain answer SHALL leave the effect uncertain without retry. Reads SHALL need no approval.

#### Scenario: Approved mode change
- **WHEN** the owner approves a proposed `set_mode` and the Hub mode has not changed since the proposal
- **THEN** one tracked `mode-set` operation is sent with the recorded expected revision, the saved mode changes, and the task's final text reports the accepted result without claiming device effects

#### Scenario: Declined or stale proposal
- **WHEN** the owner declines, or approves after the Hub mode changed
- **THEN** no command is sent for a decline; a stale approval is refused by the core with `revision-conflict` and the conversation reports it; neither path starts a duplicate command

#### Scenario: Approval after restart
- **WHEN** the runtime restarts while an approval question is waiting
- **THEN** the same question, proposal and recorded revision remain readable, and the explicit answer applies once to that proposal only

### Requirement: Core admission of assistant commands

The core SHALL answer an `assistant-dispatch` command only from `bunny/modules/companions`, forward only an allowlisted family and target to its tracked dispatcher as one operation requested by that module, and refuse any other source, family or target before anything is recorded. The operation SHALL follow the dispatcher's ordinary reply, outcome, inbox and history rules.

#### Scenario: Forwarded mode-set
- **WHEN** the companions module dispatches an approved `mode-set` for the Hub
- **THEN** the core records one tracked operation requested by the module, the mode owner answers it, and its outcome reaches history and the inbox like an operator's command

#### Scenario: Refused dispatch
- **WHEN** another source sends `assistant-dispatch`, or the module names a family or target outside the core's allowlist
- **THEN** the core refuses with `forbidden` or `invalid-request`, records no operation and sends nothing

### Requirement: Accessible conversation panel

The dashboard SHALL present the B.U.N.N.Y. conversation on the companions `assistant` page: the provider and model, allowed and unavailable tools, usage in tokens or unknown, the saved conversation with owner, assistant and tool messages, and explicit send, answer, approve, decline, resume and cancel controls. It SHALL label the synthetic provider as making no paid calls, preserve written context and saved questions on reload, and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

#### Scenario: Approval by keyboard
- **WHEN** a task waits for approval and the owner reloads the page and operates it by keyboard
- **THEN** the proposal, its target and value are readable, approve and decline have accessible names, and a successful answer receipt does not assert that the command completed

#### Scenario: Read-only and disconnected states
- **WHEN** the browser lacks control authority or loses its connection
- **THEN** saved history stays readable, every mutating control is disabled, and the page says why
