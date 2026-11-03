## MODIFIED Requirements

### Requirement: One durable shared operation inbox

The core SHALL derive one inbox item per failed (including expired), uncertain or conflicting tracked operation in the tracker transaction. Finished agent turns and gateway-only session-label-set/notice-clear metadata actions SHALL remain absent; metadata actions retain tracker/history evidence. Items SHALL survive restart until handled, without expiry or automatic clearing. Display dismissal SHALL remain separate from handling, and handling SHALL preserve device holds.

The families `art-auto`, `art-stage` and `art-ambient-set` are routine background work and SHALL raise no item, whatever their result (ADR 0012, 2026-11-03). Their operations and history SHALL still record the result. `art-request` SHALL raise items as any other command does.

#### Scenario: Late evidence and conflict
- **WHEN** definitive evidence arrives for an open uncertain item
- **THEN** its evidence updates while the item remains open
- **WHEN** a succeeded and failed outcome conflict for an operation with no item or a handled item
- **THEN** one item opens or reopens with both outcomes above its prior removal revision
- **WHEN** a nonconflicting late outcome follows handling or a reused source/message ID is refused
- **THEN** no item opens

#### Scenario: Routine art raises no item
- **WHEN** an `art-auto`, an `art-stage` and an `art-ambient-set` are refused, and an `art-request` is refused
- **THEN** each operation records its failure, and only the `art-request` opens an item

### Requirement: Explicit handling and send-again

The bounded core handling command, gateway, MCP and dashboard SHALL use one handling path that records its actor and publishes a deleted removal. Send-again SHALL use saved operation data and a new request ID for ordinary commands. An omitted payload, ONN focused text or an art stage, SHALL be refused before handling the original item; the owner can enter fresh text, or the art module can stage again, with a new request ID. Its initial tracked sent row and original handling SHALL commit together before transmission. No restart, reload, reconnect or timeout SHALL resend a command automatically.

#### Scenario: Atomic explicit resend
- **WHEN** two callers handle the same revision or the initial resend commit fails
- **THEN** at most one new tracked command is sent, and a failed initial commit preserves the original item

#### Scenario: Omitted text cannot be resent
- **WHEN** a client requests Send again for an omitted ONN text operation
- **THEN** the operation is refused before handling or transmission; the original item remains and Dismiss still works
