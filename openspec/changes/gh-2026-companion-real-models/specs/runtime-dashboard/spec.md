## MODIFIED Requirements

### Requirement: Conversations in the rail

While the current catalog declares the Conversation page of a running companions module, the rail SHALL list the chat profiles in its bottom group, above Settings, on every page: B.U.N.N.Y., Reachy and MicroDuck, each by its name with no Demo label ([Hub #2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026)). Each SHALL be a link that opens the Conversation page showing that profile with that profile's own history. The open conversation's row SHALL be marked as the current page, and on the Conversation page the Companions row SHALL be marked without a box, so that the rail boxes one row. Without that declaration the rail SHALL show no conversation group.

The group SHALL be the companions frontend's own component, which the shell mounts in its own module scope through the module's public frontend entry; the shell SHALL read no other part of that module's conversation. Choosing a profile SHALL send no command and SHALL register no speech endpoint. Choosing one while the Conversation page is open SHALL keep that page mounted, with each profile's draft.

A row SHALL carry a marker, and the words "Needs your answer" in its name, while that profile's task waits on a clarification or an approval that has no answer. A task that waits on the coding worker SHALL carry none. The marker SHALL be absent whenever the group's copy of the assistant state is missing, failed, removed, restarted or unavailable, and until the kind of the pending question has been read. The group SHALL learn the kind from one bounded read of that profile's recent history for a pending question, or from the open Conversation page when the page has read it. A read that fails SHALL NOT be repeated on a timer. It SHALL be made again when the state copy next changes or is live again, or when the open Conversation page stops showing that profile. At phone width the menu button SHALL carry the marker when a conversation other than the open one needs the owner.

In the icon rail a conversation SHALL be a tile whose name and need appear beside it on hover or keyboard focus. In the phone drawer a row SHALL be a full touch target, and choosing one SHALL close the drawer and return focus to the menu button.

#### Scenario: Open a conversation from another page
- **WHEN** the operator is on Home, Rooms or a device page and chooses a profile in the rail
- **THEN** the Conversation page opens showing that profile with its own history, and its row is marked as the current page

#### Scenario: Change profile on the Conversation page
- **WHEN** the Conversation page is open with a draft and the operator chooses another profile in the rail and then the first one again
- **THEN** each profile shows its own history and draft, the first draft is still there, and no command, sync or speech endpoint registration is sent

#### Scenario: A conversation needs the owner
- **WHEN** a profile's task waits on a clarification or an approval
- **THEN** its row carries the marker on every page, and at phone width the menu button carries it unless that conversation is the open one

#### Scenario: Delegated work
- **WHEN** a profile's task waits on the coding worker
- **THEN** its row carries no marker

#### Scenario: State is not live or the kind is not known
- **WHEN** the assistant state copy is missing, failed, removed, restarted or unavailable, or the read of the pending question fails
- **THEN** no marker is shown, the rows stay links, and the failed read is not repeated on a timer

#### Scenario: A failed read is made again
- **WHEN** the read of a pending question has failed and the state copy changes or is live again, or the open Conversation page moves to another profile
- **THEN** the group reads that question once more, and marks the row when the question needs the owner

#### Scenario: Companions is not available
- **WHEN** the catalog reports the companions module as not running, or does not declare its Conversation page
- **THEN** the rail shows no conversation group and the menu button no marker
