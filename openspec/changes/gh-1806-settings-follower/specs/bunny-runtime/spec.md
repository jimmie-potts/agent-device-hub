## ADDED Requirements

### Requirement: Standby core follows committed settings

An opt-in standby core SHALL follow the selected HTTPS peer using the existing
read grant, SDK subscriptions and committed settings history. It SHALL read on
startup, reconnect and eligible settings signals or overflow. One cancellable
capped recovery loop MAY retry connection or read failure. Only verified
receiver commits SHALL advance progress and completion evidence. A configured
standby without a receiver SHALL keep local health available and perform no
peer or token-file I/O.

#### Scenario: Settings change while registration or a read is pending

- **WHEN** a peer commits settings before the last registration completes or during a held read
- **THEN** the startup read or a serialized dirty follow-up catches the edit
- **AND** a healthy idle stream causes no periodic settings read

#### Scenario: A page scans rows outside the settings projection

- **WHEN** the pass returns skipped rows or an unsealed settings tail
- **THEN** the follower scans onward without advancing beyond the last durable seal
- **AND** the receiver applies the complete sealed transaction before progress advances

#### Scenario: Checkpoint continuity is lost

- **WHEN** the peer refuses a same-origin checkpoint after restore
- **THEN** the follower validates and replaces from a complete snapshot using exact durable expected state
- **AND** a foreign origin cannot replace the enrollment

#### Scenario: Stop interrupts a read or apply

- **WHEN** standby stops during catch-up
- **THEN** pending reads and queued applies are fenced and entered commits settle before lease release
- **AND** a restart resumes from the verified durable state
