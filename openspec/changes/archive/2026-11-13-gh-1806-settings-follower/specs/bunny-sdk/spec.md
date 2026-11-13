## ADDED Requirements

### Requirement: Caller-owned remote subscription lifetime

A remote subscription client SHALL offer an opt-in caller-owned lifetime with
strict redirects, bounded registration and stream frames, and abortable fetches.
It SHALL report loss once and leave reconnect to the caller. Its stream,
registration and live cleanup requests SHALL carry valid W3C trace context.
The edge SHALL correlate ordinary subscriptions after authentication and
connection ownership checks. Endpoint cleanup retains its separate capability
boundary. A registration refusal SHALL retire the stream before waiting for
entered handler cleanup. Participant close SHALL still wait for that cleanup.
Existing automatic clients retain their behavior.

#### Scenario: A stream is lost during registration

- **WHEN** a caller-owned stream drops during a subscription request
- **THEN** the client aborts registration and reports loss once
- **AND** the retired stream makes no cleanup call or automatic reconnect
