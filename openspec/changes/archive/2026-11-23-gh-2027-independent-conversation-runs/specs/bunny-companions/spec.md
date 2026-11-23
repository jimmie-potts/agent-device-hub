## MODIFIED Requirements

### Requirement: Single speech coordinator
The companions owner SHALL reserve one browser endpoint, admit one active announcement and, waiting, at most one card and one reply per conversation, and reuse its existing opportunity, deduplication, admission and fixed-text rules. It SHALL also admit a saved assistant reply as a candidate: the result, question or refusal that ended a task turn, or a saved assistant message the owner asked to hear again, each identified by its message and, for a replay, the owner's request. A reply SHALL rank with actionable coding attention: above notices and social speech, never above an active equal. Actionable coding attention SHALL take priority over social speech. A newer card of equal or higher rank SHALL replace the waiting card. A newer reply of the same conversation, a replay included, SHALL replace that conversation's waiting reply, while replies of other conversations SHALL be kept, and a reply and a card SHALL NOT replace each other. The voice SHALL take the waiting candidate of the highest rank first, then the earliest arrival; each SHALL still be dropped when it passes its deadline, 60 seconds for a reply. Only a strictly higher rank SHALL cut off an active announcement. Replacement SHALL wait for confirmed cancellation and SHALL recheck current policy after every asynchronous wait and immediately before submission. A reply SHALL be refused in Quiet, without the synced Hub mode, or after its deadline, and SHALL NOT depend on Reachy's text enablement or category mutes. Uncertain output SHALL prevent automatic replacement. Speech suppression SHALL NOT suppress ordinary visual coding attention. Existing synthetic scenario controls SHALL produce zero audio.

#### Scenario: Competing candidates and tabs
- **WHEN** two tabs enable speech or duplicate and competing opportunities arrive
- **THEN** one reserved endpoint receives at most one active command, with at most one waiting card and one waiting reply per conversation
- **AND** a second tab cannot take over and duplicate opportunities cannot speak again

#### Scenario: Separate social allowance
- **WHEN** a social candidate is blocked by its Free-only, busy, media, snooze, daily or spacing policy
- **THEN** it cannot consume coding admission or hide visual coding attention
- **AND** manual coding availability does not qualify unknown social inputs or make scenario fixtures audible

#### Scenario: Durable result without replay
- **WHEN** an accepted speech operation restarts before its receipt is committed
- **THEN** the owner reports uncertainty through its existing outcome path without restoring availability or executing the utterance again

#### Scenario: Reply among other candidates
- **WHEN** a saved reply is offered while a notice is playing, then a second reply of the same conversation arrives while the first reply is waiting
- **THEN** the notice is stopped and the newest reply alone plays after confirmed cancellation, a coding question offered during the reply waits for it, and the same reply key never speaks twice

#### Scenario: Reply refused by policy
- **WHEN** a reply is offered in Quiet, without a synced Hub mode, after its deadline or before the endpoint was enabled
- **THEN** no utterance is sent and nothing is caught up when speech is enabled later

#### Scenario: Replies from several conversations
- **WHEN** one reply is speaking and, while it plays, replies from two other conversations, two replies from the speaking reply's conversation, a coding question card and a reply that goes stale arrive
- **THEN** nothing of equal rank interrupts, and afterwards the voice speaks the other two conversations' replies, the card and the newest reply of the first conversation in arrival order, while the replaced and the stale replies never speak

#### Scenario: Highest rank first
- **WHEN** a notice card and then another conversation's reply wait behind a speaking reply
- **THEN** the reply speaks before the earlier notice, which then still speaks

#### Scenario: Stop clears every waiting candidate
- **WHEN** the owner stops speech while replies from several conversations and a card wait
- **THEN** none of them speaks afterwards
