## MODIFIED Requirements

### Requirement: Qualified Codex Desktop read actions preserve the native target

An explicitly enrolled Codex Desktop observer using the qualified native protocol SHALL correlate the actual client's native read request and successful response on the same controlled connection. It SHALL require an observed unread revision and the matching latest completed native turn before the request. It SHALL bind the existing lifecycle session's full identity, generation, known turn and finished notice at that request, and SHALL never bind a delayed response to a later owner target. It SHALL preserve `codex/local` identity and emit only the existing provider-client lifecycle/2.1 receipt.

The observer SHALL NOT issue native read updates, infer a read from shared notifications or absent markers, capture prompt/reply/transcript content, or publish title/archive evidence. It SHALL require a distinct qualified source credential and use the existing SDK sync/event stream. It SHALL leave native protocol bytes and permission decisions unchanged. Bounds, expired correlation, malformed traffic, lost owner freshness, unsupported protocol shapes and observation errors SHALL suppress affected receipts while native traffic continues. Reconnection SHALL discard pending actions and require fresh evidence; no offline read action SHALL replay automatically.

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
- **WHEN** enrollment is absent or unsafe, the native protocol is unsupported, parsing exceeds its bounds, or the receipt endpoint fails
- **THEN** native input and output continue unchanged without waiting for B.U.N.N.Y. or a device
- **AND** the observer makes no successful-read claim

#### Scenario: Native exit while collection is stalled
- **WHEN** the native app-server exits while a collector filesystem or DNS operation remains blocked
- **THEN** the observer forwards the completed native output and ends within its bounded shutdown period without waiting for that operation
- **AND** it uses `SIGKILL` if native work does not settle; an ordinary exit retains the native exit code

#### Scenario: Explicit installation
- **WHEN** the operator selects the qualified Desktop launcher and dedicated producer configuration
- **THEN** observation belongs only to that controlled native connection and provider feed
- **AND** personal hooks, agent permissions and unrelated running clients are unchanged

#### Scenario: Compatible application updates
- **WHEN** the selected Codex application or its bundled native executable changes version or build but its native read protocol retains the required evidence
- **THEN** the observer continues to admit matching read actions with the same enrolled producer identity and credential
- **AND** version labels alone neither qualify nor reject an action

#### Scenario: An update changes essential evidence
- **WHEN** updated native traffic omits or changes the required client identity, turn selection, unread revision, read operation or successful changed-revision response
- **THEN** that traffic produces no positive receipt and native traffic continues unchanged
- **AND** a shared notification or an apparently newer version cannot substitute for the missing evidence

#### Scenario: Launch inspection
- **WHEN** the operator checks the launcher against the selected Codex bundle
- **THEN** the check reports observed versions and whether the observer can be selected for that bundle without opening the application
- **AND** it does not claim protocol compatibility, a human action or installed acceptance merely from those versions
