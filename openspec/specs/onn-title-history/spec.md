# ONN title history Specification

## Purpose

Retain private selected-title observations and reported progress from one ONN, with honest identity, freshness and collection gaps, and bounded authenticated queries that never operate the TV.

## Requirements

### Requirement: Fixed bounded read-only collection

When explicitly enabled, the ONN owner SHALL collect only the approved YouTube/Stremio metadata projection through the selected fixed reader, without an open dashboard or conversation. It SHALL validate the closed versioned wire, field/session/reply bounds, finite source numbers and release-pinned device artifact. A poll SHALL share the existing private ADB operation-wide cancellation and five-second bound, serialize with controls, prioritize controls and never install, repair, retry, discover or command a device. Unsupported or unavailable reads SHALL expose a gap without blocking controls. Disabling collection SHALL retain earlier history.

#### Scenario: Selected source and refusal
- **WHEN** collection receives a valid selected session, an empty session list or an invalid/oversized reply
- **THEN** it accepts the supported projection, clears current content on empty success or records unavailable evidence, respectively, without a device input action
- **WHEN** the reader artifact is absent/mismatched or a control takes priority
- **THEN** the poll is unavailable or skipped as a gap and ordinary controls remain independent

### Requirement: Immutable private observations and conservative identity

The owner SHALL retain credential-excluded original selected fields and observed revisions indefinitely with intake/run/poll identity, source/reader/app provenance, host receive time, available device/source clocks and explicit omissions. Intake SHALL persist atomically before durable acceptance, be idempotent for the same intake identity and refuse conflicting reuse. Local occurrences SHALL distinguish supported source identity from unsupported/ambiguous identity; a title alone SHALL NOT join two items. No observation SHALL assert attention, main-video playback, watched duration, completion, inferred topics or ad classification.

#### Scenario: Both apps and same-title ambiguity
- **WHEN** synthetic YouTube videos, a Stremio movie and episode transitions are collected, including distinct items sharing a title without stable IDs
- **THEN** the originals and available channel/series/episode strings remain recoverable and unsupported identity is explicit rather than silently merging those items

#### Scenario: Credentials and indefinite retention
- **WHEN** selected text contains recognized credentials alongside ordinary personal text, or synthetic age advances and derived views are rebuilt
- **THEN** credentials are excluded before storage with safe omissions, surrounding ordinary text and accepted original rows remain, and no automatic expiry or erasure occurs

### Requirement: Truthful current state and recovery

Current content SHALL expose fresh, stale, unavailable and gap evidence, become stale after fifteen seconds without a fresh accepted observation and clear on an accepted empty sample. Multiple ambiguous sessions SHALL NOT become one confidently current title. Reported state, position and duration SHALL remain last-observed source values without extrapolation. Startup, source failure, busy polls, storage failure, host-clock changes and device-clock resets SHALL remain visible gaps. Restart/recovery SHALL retain accepted originals and never manufacture observations or send a device command.

#### Scenario: Playback changes and exit
- **WHEN** fixtures report pause, buffering, seeks, resumed playback, title/episode changes or app exit
- **THEN** current state and retained observations follow the reported values, and an old title is not confidently current after a clearing sample or content change

#### Scenario: Storage and clock faults
- **WHEN** storage fails, capacity is exhausted, clocks jump or the collector restarts/disconnects
- **THEN** earlier originals remain intact, failed intake is not acknowledged as durable, loss/gaps remain visible and controls are not replayed or blocked by metadata success

### Requirement: Shared bounded authenticated history reads

The existing authenticated content and MCP contributions SHALL expose the same stored-data `history` and `history_detail` queries, with app/date/title filters, local occurrence IDs, supported metadata/progress, provenance, confidence, omissions and gaps. Inputs SHALL be closed and use shared error codes. Pages SHALL default to fifty and permit at most one hundred summaries/observations, use a stable evidence cutoff and deterministic cursors, and enforce an output-byte bound with explicit projection loss. Indexed app/evidence ordering and bounded date/title candidate windows SHALL prevent an indefinite archive scan; an exhausted window SHALL return continuation even if no title matched. Queries SHALL perform no ADB operation, playback, account import or model call.

#### Scenario: Stable paging and compatible MCP
- **WHEN** an authenticated reader pages history/detail while new observations arrive
- **THEN** HTTP/content and a real MCP SDK client return consistent cutoff-bound evidence with safe continuation, while invalid inputs and unauthorized access are refused without device work
- **WHEN** a bounded title window has no match or a detail page reaches its byte bound
- **THEN** continuation and explicit omissions preserve access to later bounded evidence rather than silently truncating a successful archive read
