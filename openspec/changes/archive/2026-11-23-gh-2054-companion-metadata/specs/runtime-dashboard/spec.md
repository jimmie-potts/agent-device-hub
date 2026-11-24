## ADDED Requirements

### Requirement: Companion on native session tiles

The dashboard's session tile SHALL show a native session's companions apart from its name ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). The face's first line SHALL begin with a neutral chip for each companion whose display name differs from the session's displayed name (the label, then the title), named `Companion: <name>` for assistive technology, before the client and the evidence age, and the line SHALL stay one line inside the tile at phone and desktop widths. An untitled session that shows its persona SHALL show no tag, so the name never appears twice. The expanded facts SHALL add a Companion row (Companions for several) with the names in the record's order, and the sessions widget's search SHALL match a companion's name. A session without companions SHALL render as before.

#### Scenario: Untitled and renamed
- **WHEN** a B.U.N.N.Y. conversation's session shows its persona name, and the owner then renames the conversation
- **THEN** the untitled tile has no tag and its facts name the companion, and the renamed tile shows the tag `Companion: B.U.N.N.Y.` before the client with the new title as its heading

#### Scenario: Search and other sessions
- **WHEN** the owner types the companion's name into the search beside a Claude session
- **THEN** only the conversation's session stays listed, and the Claude tile has no tag and no Companion row

#### Scenario: Widths
- **WHEN** the tagged tile is shown at 1280 px and at 390 by 844 px
- **THEN** the tag, the client and the evidence age share one line inside the tile, and the page has no horizontal scroll
