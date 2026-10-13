# Bunny assistant tasks specification

## Purpose

Allow one local owner to retain and explicitly resume a bounded synthetic assistant task without a model account, a second runtime or device effects.

## Requirements

### Requirement: Durable explicit task activation

The system SHALL preserve inspectable, versioned conversations, messages, tasks, questions, answers, runs and logical call receipts in the companions-owned database. Conversation/task/question identity SHALL survive restart; each activation SHALL use a new run identity. Profile threads for B.U.N.N.Y., Reachy and MicroDuck SHALL remain distinct. Startup SHALL reconcile saved state without executing work.

#### Scenario: Question survives restart
- **WHEN** a task pauses for clarification and the process stops
- **THEN** the same task/question and admitted messages remain readable after restart, and an explicit resume uses a new run without repeating completed calls

#### Scenario: Answer was saved before interruption
- **WHEN** the process stops after saving an answer but before graph continuation
- **THEN** the saved answer remains readable and explicit resume consumes it once

#### Scenario: Unknown admitted call or incompatible graph
- **WHEN** recovery finds an admitted call without a result or an unsupported graph version
- **THEN** it preserves readable evidence, reports uncertainty or unavailability and refuses automatic retry or an empty replacement thread

### Requirement: Bounded single execution

The system SHALL admit at most one unfinished task across profiles and one invocation, with no execution queue. Each task SHALL retain limits of four model calls, two read-tool calls, two questions, 120 seconds active time, 8,192 fake usage units and zero paid calls. Model/tool deadlines SHALL be 30/5 seconds and control admission five seconds. Inputs, tool results and serialized working state SHALL be bounded at 4/8/32 KiB. Reservations SHALL precede dispatch and survive restart; unreported usage SHALL remain unknown.

#### Scenario: A limit is exhausted
- **WHEN** another operation would exceed a persisted limit
- **THEN** it is refused before dispatch, including after resume or restart

#### Scenario: Cancellation and late result
- **WHEN** cancellation is durably saved while a call is pending
- **THEN** later steps remain fenced, abort is best effort, and a late result can update evidence but cannot reactivate the task

### Requirement: Private authorized controls and truthful outcomes

Inputs SHALL use bounded authenticated upload staging with references bound to request, profile, task, question and expected revision. Controls SHALL enter through core authorization. Public summaries, core operations and diagnostics SHALL omit conversation text. Conversation reads SHALL use the existing authenticated read scope and pagination with responses at most 64 KiB. Domain changes and command outcomes SHALL commit together through the SDK outbox. A successful control SHALL describe its durable local transition separately from task completion.

#### Scenario: Duplicate or stale control
- **WHEN** a start, answer or resume is duplicated, stale, or addresses the wrong question
- **THEN** it cannot duplicate work or consume an answer again, even with a new request ID

#### Scenario: Refused admission
- **WHEN** authorization, input validation or durable admission fails, including full disk
- **THEN** no graph starts and the existing error registry describes the refusal without private content

#### Scenario: Outbox recovery
- **WHEN** committed outcomes are republished after restart
- **THEN** their original identity and trace survive and no task is activated by republishing

### Requirement: Optional accessible synthetic task panel

The dashboard SHALL label the fake workflow, preserve written context and saved questions/answers on reload, provide explicit start/answer/resume/cancel controls and distinguish control receipts from task state. Disconnection SHALL be visible and prevent mutation against stale state. Assistant activation SHALL default off without affecting fixed-text Reachy or coding-session lifecycle ownership.

#### Scenario: Reload and keyboard use
- **WHEN** an owner reloads a waiting task and operates the panel by keyboard
- **THEN** saved context and the question are available, controls have accessible names, and a successful answer receipt does not assert completion

### Requirement: Registered safe diagnostics

Assistant run/model/tool spans and decision records SHALL use the SDK diagnostic contract and registered identifiers. Spans SHALL finish at human waits and shutdown; subsequent runs SHALL link prior context. Logs SHALL contain only fixed codes, identifiers and bounded numeric evidence. A failed diagnostic sink SHALL not change execution outcomes.

#### Scenario: Correlated private task
- **WHEN** a synthetic request starts a run and a model/tool call
- **THEN** registered records correlate request, task, run and logical effect without prompts, tool bodies, credentials or exception text
