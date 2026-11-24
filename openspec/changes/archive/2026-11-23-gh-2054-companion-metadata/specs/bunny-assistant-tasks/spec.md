## ADDED Requirements

### Requirement: Conversation sessions name their companion

The companions module SHALL name each conversation's companion on every lifecycle observation it reports, as the single entry of `companions` with the profile's ID and persona name, in `lifecycle/2.4` ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). Title metadata SHALL stay in `lifecycle/2.3` and SHALL carry no companions, so a generated title or an owner's rename never changes them. The module SHALL never add the companion's name to a title; an untitled conversation keeps its persona name as the title until one exists.

#### Scenario: Each conversation's companion
- **WHEN** a Reachy task and then a B.U.N.N.Y. task run in their conversations
- **THEN** every observation of the first names `reachy` with name `Reachy`, every observation of the second names `bunny` with name `B.U.N.N.Y.`, and all are `lifecycle/2.4`

#### Scenario: A titled conversation
- **WHEN** a conversation has a generated title and then the owner's title
- **THEN** its observations carry that title unchanged and the same companion, and its title metadata is `lifecycle/2.3` without companions
