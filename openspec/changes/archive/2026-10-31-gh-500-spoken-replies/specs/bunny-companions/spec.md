## MODIFIED Requirements

### Requirement: Single speech coordinator
The companions owner SHALL reserve one browser endpoint, admit at most one active and one current pending announcement, and reuse its existing opportunity, deduplication, admission and fixed-text rules. It SHALL also admit a saved assistant reply as a candidate: the result, question or refusal that ended a task turn, or a saved assistant message the owner asked to hear again, each identified by its message and, for a replay, the owner's request. A reply SHALL rank with actionable coding attention: above notices and social speech, never above an active equal. Actionable coding attention SHALL take priority over social speech. A newer pending candidate of equal rank SHALL replace the older pending one. Replacement SHALL wait for confirmed cancellation and SHALL recheck current policy after every asynchronous wait and immediately before submission. A reply SHALL be refused in Quiet, without the synced Hub mode, or after its deadline, and SHALL NOT depend on Reachy's text enablement or category mutes. Uncertain output SHALL prevent automatic replacement. Speech suppression SHALL NOT suppress ordinary visual coding attention. Existing synthetic scenario controls SHALL produce zero audio.

#### Scenario: Competing candidates and tabs
- **WHEN** two tabs enable speech or duplicate and competing opportunities arrive
- **THEN** one reserved endpoint receives at most one active command and one current pending candidate
- **AND** a second tab cannot take over and duplicate opportunities cannot speak again

#### Scenario: Separate social allowance
- **WHEN** a social candidate is blocked by its Free-only, busy, media, snooze, daily or spacing policy
- **THEN** it cannot consume coding admission or hide visual coding attention
- **AND** manual coding availability does not qualify unknown social inputs or make scenario fixtures audible

#### Scenario: Durable result without replay
- **WHEN** an accepted speech operation restarts before its receipt is committed
- **THEN** the owner reports uncertainty through its existing outcome path without restoring availability or executing the utterance again

#### Scenario: Reply among other candidates
- **WHEN** a saved reply is offered while a notice is playing, then a second reply arrives while the first reply is pending
- **THEN** the notice is stopped and the newest reply alone plays after confirmed cancellation, a coding question offered during the reply waits for it, and the same reply key never speaks twice

#### Scenario: Reply refused by policy
- **WHEN** a reply is offered in Quiet, without a synced Hub mode, after its deadline or before the endpoint was enabled
- **THEN** no utterance is sent and nothing is caught up when speech is enabled later
