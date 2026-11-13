## ADDED Requirements

### Requirement: Caller-owned remote subscription lifetime

A remote subscription client SHALL offer an opt-in caller-owned lifetime with
strict redirects, bounded registration and stream frames, and abortable fetches.
It SHALL report loss once and leave reconnect to the caller. Existing automatic
clients retain their behavior.

#### Scenario: A stream is lost during registration

- **WHEN** a caller-owned stream drops during a subscription request
- **THEN** the client aborts registration and reports loss once
- **AND** the retired stream makes no cleanup call or automatic reconnect
