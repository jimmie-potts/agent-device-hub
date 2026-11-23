## ADDED Requirements

### Requirement: Correlate sent artwork with its library and display results

The authenticated Conversation Send request SHALL bind one attachment reference to the originating message. The library save and physical show SHALL use distinct stable tracked request identities for the same artwork and follow the original exchange. A guarded physical show SHALL bind the exact selected routing identity and its current configuration. Binary media SHALL stay on the existing authenticated upload and content routes. The Companions-only save SHALL use `assistant-dispatch/2.4` and `art-attachment-edit/2.1`, which accept only a save of an uploaded artwork reference. The browser retains the released 2.0 attachment contract.

#### Scenario: A target changes before dispatch

- **WHEN** the configured target no longer matches the identity bound by the direct playback instruction
- **THEN** the tracked show reports the registered refusal and sends nothing to the replacement

#### Scenario: Evidence becomes available after the reply

- **WHEN** the original reply reports pending display confirmation and definitive evidence later arrives for the tracked show
- **THEN** the original exchange receives one correlated update without a new device write or a second turn-end notice
