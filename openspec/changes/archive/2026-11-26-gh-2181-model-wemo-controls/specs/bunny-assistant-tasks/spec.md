## ADDED Requirements

### Requirement: Model-interpreted Wemo power proposals

The selected Conversation supervisor SHALL interpret the current authenticated owner request using the common context and grants. It SHALL distinguish a question, a request needing clarification and a power action for one or two configured Wemo plugs. The Hub SHALL bind a typed action to the current request, any eligible clarification and the eligible target references. The Hub SHALL validate the whole selection, current access, registered ownership, power capability and target guards before dispatch. It SHALL use the existing tracked generic power dispatch and the designated Wemo writer with its hold and maximum-on policy. Permitted conversation facts and a scoped lookup of configured Wemo IDs and labels MAY identify a referenced device. The current owner request supplies authorization.

#### Scenario: Two plugs followed by one reference

- **WHEN** the owner asks any companion to operate two named Wemo plugs and then asks to operate just one using the previous exchange
- **THEN** the first request dispatches once for each intended target and the next request dispatches once for the one resolved target
- **AND** both configured supervisors use the same proposal and validation rules

#### Scenario: A relative description needs a lookup

- **WHEN** the owner describes a plug without using its configured name or ID
- **THEN** the supervisor can resolve the request using the permitted target lookup and prior Conversation facts
- **AND** the Hub checks the chosen ID against the disclosed records and their current guards

#### Scenario: A request mentions two exact IDs

- **WHEN** a power request explicitly contains two registered ID references
- **THEN** the proposal accounts for each ID as a target or as context the owner intends to leave alone
- **AND** an unaccounted ID prevents any dispatch from that proposal
- **AND** the receipt states that the Hub sent no command to each context-only ID

#### Scenario: Ambiguous or superseded request

- **WHEN** the request leaves an intended target or setting unresolved
- **THEN** the companion asks one focused question before sending any power command
- **AND** an exact eligible ID selects that device independently of other devices' labels
- **AND** a concrete target selection in the answer constrains the proposal, including group selections
- **AND** a steer supersedes any part of the previous request that has yet to send

#### Scenario: Questions and contextual text

- **WHEN** the owner asks a state question, quotes an example, describes a hypothetical action or says to leave a plug alone
- **THEN** the supervisor proposes no power action
- **AND** words in device labels, prior messages, tool results and assistant suggestions supply no command authority

#### Scenario: Independent results with a lost reply

- **WHEN** a request reaches more than one plug and a result is unavailable, expired, failed or uncertain
- **THEN** the original exchange reports each target's own receipt and retains any confirmed result
- **AND** duplicate delivery and restart preserve each operation identity without resending a possibly sent effect
- **AND** transmission alone establishes no observed plug power
