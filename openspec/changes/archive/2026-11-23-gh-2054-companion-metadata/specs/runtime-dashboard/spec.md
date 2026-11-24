## ADDED Requirements

### Requirement: Companion on native session tiles

The dashboard's session tile SHALL show a native session's companions apart from its name ([Hub #2054](https://github.com/jimmie-potts/agent-device-hub/issues/2054)). Of the companions whose display name differs from the session's displayed name (the label, then the title), the face's first line SHALL begin with a neutral chip for the first, named `Companion: <name>` for assistive technology, followed, when there are others, by a `+N` count named `and N more companions: <names>`, and then the evidence age. Beside a tag the line SHALL leave out the client, and the expanded facts SHALL keep it as a Client row (owner decisions on #2054, 2026-11-24). The line SHALL stay one line inside the tile at phone and desktop widths, with the evidence age whole, and SHALL be as tall as a line without a tag. An untitled session that shows its persona SHALL show no tag, so the name never appears twice. The expanded facts SHALL add a Companion row (Companions for several) with every name in the record's order, and the sessions widget's search SHALL match a companion's name or ID. A session without companions SHALL render as before.

#### Scenario: Untitled and renamed
- **WHEN** a B.U.N.N.Y. conversation's session shows its persona name, and the owner then renames the conversation
- **THEN** the untitled tile has no tag, keeps its client and its facts name the companion, and the renamed tile shows the tag `Companion: B.U.N.N.Y.` in place of the client, with the new title as its heading and the client in its facts

#### Scenario: Several companions
- **WHEN** a session's record names B.U.N.N.Y., Reachy and MicroDuck
- **THEN** its face shows the tag `Companion: B.U.N.N.Y.` and the count `+2`, named `and 2 more companions: Reachy, MicroDuck`, and its facts list all three

#### Scenario: Search and other sessions
- **WHEN** the owner types the companion's name, or `bunny`, into the search beside a Claude session
- **THEN** only the conversation's session stays listed, and the Claude tile has no tag, keeps its client and has no Companion row

#### Scenario: Widths
- **WHEN** the tagged tile and the three-companion tile are shown at 1280 px and at 390 by 844 px
- **THEN** each first line stays one line inside the tile with the evidence age whole, as tall as the neighbouring Claude tile's, whose heading it lines up with, and the page has no horizontal scroll
