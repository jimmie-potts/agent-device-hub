## ADDED Requirements

### Requirement: A single missed NL22 playback status check holds frames

During live Music or saved-show playback on NL22 Light Panels, the module SHALL withhold datagrams after a scheduled ownership read exceeds its deadline. It SHALL use the existing check cadence and require explicit confirmation of the stream selection, power on and unchanged brightness before sending a current frame. Show position, cue accounting and source expiry SHALL continue under their existing clocks and rules. This behavior applies to NL22 playback status deadlines only.

#### Scenario: The next scheduled check confirms ownership

- **WHEN** one ownership check reaches its deadline and the next scheduled check confirms the light still shows the same stream under the existing ownership guard
- **THEN** rendering continues with current frames, without backfill or a second streaming entry, and a later deadline gets the same one-check allowance

#### Scenario: Consecutive misses or confirmed takeover

- **WHEN** the next check also misses its deadline while the session still owns playback, or a check confirms a manual change, including a report of power off or changed brightness in an otherwise incomplete reply
- **THEN** the affected session ends as `device` with `unavailable` for consecutive misses or `manual` for takeover, both without restoration

#### Scenario: An ending becomes due while frames are held

- **WHEN** Stop, alert, source loss, show completion or a newer choice ends the session during the hold
- **THEN** the pending ending retains its existing priority and restoration guard, and no playback frames resume
- **AND** any restoration requires a fresh confirmation of selection, power on and unchanged brightness

#### Scenario: A failure outside the allowance

- **WHEN** Lines misses a playback status check, a check during the hold gives incomplete evidence without confirming a change, or an NL22 ownership read fails for a reason other than a deadline
- **THEN** the existing immediate device failure applies
