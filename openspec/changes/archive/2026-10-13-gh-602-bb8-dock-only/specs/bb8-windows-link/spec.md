## ADDED Requirements

### Requirement: Finite docked zero-speed gestures
The Windows owner SHALL execute only the fixed look-left, look-right and shake-head heading sequences. Every segment SHALL request zero speed, last at most 300 ms and use the existing local selected Stop with a distinct packet sequence, even if the heading response is missing. Before each segment, a newly requested valid power report SHALL say charging. Gesture completion SHALL claim transmission, not observed head position or physical rest. Stop SHALL interrupt the active segment and prevent later segments, taking priority over queued work; the queue/results SHALL reserve its existing Stop capacity. No stored gesture SHALL replay after restart or reconnect. Existing ownership, identity, expiry, byte-spacing and response limits SHALL apply. No raw motors, macro upload, arbitrary animation ID or firmware setting SHALL be written.

#### Scenario: Zero-speed gesture with no reply
- **WHEN** a zero-speed heading segment reaches its finite end without a matching reply
- **THEN** its selected Stop uses a new sequence, remaining segments abort and the uncertain result is not reported as visible success

#### Scenario: Stop during charging or heading
- **WHEN** Stop arrives during a gesture's charging check or active heading segment
- **THEN** no later segment begins; a possible heading write receives its selected local Stop and the explicit Stop is prioritized

#### Scenario: Unavailable charging evidence
- **WHEN** the power response is missing, invalid or does not say charging
- **THEN** no following heading segment is sent

#### Scenario: Passive restart
- **WHEN** the helper starts with admitted or effect-start gesture responsibility
- **THEN** it reconciles/fails/marks uncertain from existing receipt rules without loading native radio or replaying the gesture
