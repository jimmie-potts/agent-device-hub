## ADDED Requirements

### Requirement: Track prepared show commands through the Music lighting owner

The core SHALL accept an explicit operator start of a saved revision for one light and dispatch one tracked work request to that light's Nanoleaf module. It SHALL fence prepared transport controls by expected core revision and active generation. Prepared standalone playback SHALL use its runtime clock independently of Music capture and playback observations. Existing live Music requests SHALL retain their behavior.

#### Scenario: Concurrent and expired controls

- **WHEN** a transport request is stale, a duplicate request arrives, or queued work expires
- **THEN** no new device frame is authorized by that work and the established tracked outcome rules apply

#### Scenario: Standalone without a Music position

- **WHEN** a valid decorative show is started while Music capture and the Music.app position source are unavailable
- **THEN** it may run on the standalone runtime clock and its state does not imply synchronization to a recording
