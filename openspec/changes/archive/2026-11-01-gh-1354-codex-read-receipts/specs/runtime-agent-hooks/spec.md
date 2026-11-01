## ADDED Requirements

### Requirement: Qualified Codex Desktop read actions preserve the native target

An explicitly enrolled, version-qualified Codex Desktop observer SHALL correlate the actual client's native read request and successful response on the same controlled connection. It SHALL require an observed unread revision and the matching latest completed native turn before the request. It SHALL bind the existing lifecycle session's full identity, generation, known turn and finished notice at that request, and SHALL never bind a delayed response to a later owner target. It SHALL preserve `codex/local` identity and emit only the existing provider-client lifecycle/2.1 receipt.

The observer SHALL NOT issue native read updates, infer a read from shared notifications or absent markers, capture prompt/reply/transcript content, or publish title/archive evidence. It SHALL require a distinct qualified source credential and use the existing SDK sync/event stream. It SHALL leave native protocol bytes and permission decisions unchanged. Bounds, expired correlation, malformed traffic, lost owner freshness, unsupported versions and observation errors SHALL suppress affected receipts while native traffic continues. Reconnection SHALL discard pending actions and require fresh evidence; no offline read action SHALL replay automatically.

#### Scenario: Open one completed thread
- **WHEN** the qualified Desktop opens completed thread A and its native read request succeeds while thread B remains unopened
- **THEN** only A's frozen completed owner target receives a receipt
- **AND** B's read state remains unchanged

#### Scenario: Native action is not established
- **WHEN** a snapshot or notification arrives without the matching Desktop request, the request fails, the latest completed turn is unknown, or an explicit unread action occurs
- **THEN** no positive receipt is produced from that evidence

#### Scenario: A newer turn or connection replaces the observed target
- **WHEN** a newer turn begins, pending correlation expires, or the native/owner connection loses freshness before publication
- **THEN** the pending action is discarded and cannot be rebound after recovery

#### Scenario: Observer is unavailable
- **WHEN** enrollment is absent or unsafe, a version is unsupported, parsing exceeds its bounds, or the receipt endpoint fails
- **THEN** native input and output continue unchanged without waiting for B.U.N.N.Y. or a device
- **AND** the observer makes no successful-read claim

#### Scenario: Explicit installation
- **WHEN** the operator selects the qualified Desktop launcher and dedicated producer configuration
- **THEN** observation belongs only to that controlled native connection and provider feed
- **AND** personal hooks, agent permissions and unrelated running clients are unchanged
