# Shared inbox and history Specification

## Purpose

Keep failed, uncertain and conflicting operations available for explicit handling
across dashboard and MCP clients, with read-only access to retained history.

## Requirements

### Requirement: One durable shared operation inbox

The core SHALL derive one inbox item per failed (including expired), uncertain or conflicting tracked operation in the tracker transaction. Finished agent turns and gateway-only session-label-set/notice-clear metadata actions SHALL remain absent; metadata actions retain tracker/history evidence. Items SHALL survive restart until handled, without expiry or automatic clearing; a later success SHALL clear nothing. Display dismissal SHALL remain separate from handling, and handling SHALL preserve device holds.

The families `art-auto`, `art-stage` and `art-ambient-set` are routine background work and SHALL raise no item, whatever their result (ADR 0012, 2026-11-03). Their operations and history SHALL still record the result. `art-request` SHALL raise items as any other command does.

An operation whose only possible handling is Dismiss SHALL raise no item (owner decisions D1 and D3, #1657, 2026-11-10), whoever requested it:

- a rejected reply, which proves the owner refused the command before acting, so it left no effect and holds no device, when no later outcome contradicts it and Send again by the dashboard would be refused for it under the rule that Send again applies;
- a `companion-speech-*` operation whose result is uncertain, which holds no device.

The open rule and Send again SHALL read one shared rule, so they cannot disagree. Every such operation SHALL still record its result, code and detail in its tracked operation and history. Every other failed, uncertain or conflicting operation SHALL raise an item, including an uncertain write that may set a device hold, a conflict, a failure after acceptance, an expired command and a refusal the dashboard can send again.

#### Scenario: Late evidence and conflict
- **WHEN** definitive evidence arrives for an open uncertain item
- **THEN** its evidence updates while the item remains open
- **WHEN** a succeeded and failed outcome conflict for an operation with no item or a handled item
- **THEN** one item opens or reopens with both outcomes above its prior removal revision
- **WHEN** a nonconflicting late outcome follows handling or a reused source/message ID is refused
- **THEN** no item opens

#### Scenario: Routine art raises no item
- **WHEN** an `art-auto`, an `art-stage` and an `art-ambient-set` are refused, and an `art-request` is refused
- **THEN** each operation records its failure, and only the `art-request` opens an item; the tracker row and history stay as durable evidence, and the `operation` record can be retired after 256 settled records

#### Scenario: Expected refusals stay in history
- **WHEN** a display refuses a scheduled art moment `invalid-state`, a light refuses core-dispatched Music lighting work `invalid-state`, or the Hub mode refuses a mode change `revision-conflict` for its saved expected revision
- **THEN** each operation and its history keep the refusal's code and detail, and no item opens

#### Scenario: Refusals the dashboard can repeat still open items
- **WHEN** a display refuses a moment without art, or the owner's art request or media start is refused
- **THEN** an item opens, and Send again remains available for it

#### Scenario: Unconfirmed speech stays in history
- **WHEN** a companion speech line ends uncertain, and another fails after the companions module accepted it
- **THEN** only the failed line opens an item, and both outcomes stay in history

#### Scenario: Device holds still open items
- **WHEN** a device write ends uncertain or fails after acceptance and may set a device hold
- **THEN** an item opens, and handling it never releases the hold

### Requirement: Explicit handling and send-again

The bounded core handling command, gateway, MCP and dashboard SHALL use one handling path that records its actor and publishes a deleted removal. Send-again SHALL use saved operation data and a new request ID for ordinary commands. An omitted payload, ONN focused text or an art stage, SHALL be refused before handling the original item; the owner can enter fresh text, or the art module can stage again, with a new request ID. A moment naming art SHALL be refused with `forbidden` before handling the original item, because a fresh one must pass the core's arbitration. A Hub mode change (`mode-set` or `mode-override-set`) refused `revision-conflict` for its saved expected revision SHALL be refused with `revision-conflict` before handling the original item, because the mode's revision only grows and the saved payload can never be accepted again; the owner chooses the mode again from its current record. Send again SHALL also refuse, before handling, a family the handler may not request, as the dispatcher's requester rules state. Its initial tracked sent row and original handling SHALL commit together before transmission; a fresh refusal of the resent command SHALL be recorded on the new request, and its own item SHALL follow the open rule. No restart, reload, reconnect or timeout SHALL resend a command automatically.

#### Scenario: Atomic explicit resend
- **WHEN** two callers handle the same revision or the initial resend commit fails
- **THEN** at most one new tracked command is sent, and a failed initial commit preserves the original item

#### Scenario: Omitted text cannot be resent
- **WHEN** a client requests Send again for an omitted ONN text operation
- **THEN** the operation is refused before handling or transmission; the original item remains and Dismiss still works

#### Scenario: A stale mode revision cannot be resent
- **WHEN** a client requests Send again for an open item of a mode change refused `revision-conflict` for its saved expected revision
- **THEN** Send again is refused with `revision-conflict` before handling or transmission; the original item remains and Dismiss still works

### Requirement: Read-only filtered history surfaces

Every authorized reader SHALL see the whole inbox and history. Gateway and MCP history reads SHALL validate and combine inclusive time, kind, source and qualified-session filters without triggering actions. An optional `limit` SHALL accept only integers 1..500 and select the latest matching records by committed sequence before materializing or decoding the result, then return those records oldest first. Omitted limits SHALL preserve the complete matching result and existing ordering. Invalid or duplicate HTTP filters SHALL retain the existing invalid-request refusal and read authorization. The dashboard SHALL present the synced inbox and a keyboard-accessible filtered timeline, hide write controls from readers and disable stale writes.

#### Scenario: Shared handling and private retained reads
- **WHEN** an operator handles an item in the dashboard
- **THEN** a subsequent MCP inbox read shows it absent
- **WHEN** a reader filters history or reloads the dashboard
- **THEN** no device command is sent

#### Scenario: Bounded matching read
- **WHEN** HTTP or MCP reads more than 500 retained records with combined filters and a limit of 1, 200 or 500
- **THEN** only the latest matching records up to that limit are materialized and returned oldest first
- **AND** other retained records remain unchanged and available through existing reads

#### Scenario: Invalid limit
- **WHEN** a reader supplies a zero, negative, fractional, oversized or noninteger limit, or repeats the HTTP parameter
- **THEN** the read is refused with invalid-request without commands or privilege changes

### Requirement: Existing sync message bound

A synthetic 1,000-item inbox sync SHALL record the largest encoded state or sync-completed message and total answer bytes, verifying the existing 256 KiB per-message bound without imposing an aggregate cap or timing target.

#### Scenario: One synthetic size check
- **WHEN** 1,000 synthetic open items sync
- **THEN** every encoded message fits the existing cap and both maximum and aggregate bytes are recorded
