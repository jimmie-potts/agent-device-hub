## MODIFIED Requirements

### Requirement: Compact content for a shape
Every Home card SHALL offer only shapes whose content fits at the 220px unit, with nothing clipped and no stretched card; a closed card SHALL NOT scroll inside. The one exception (owner decision 2026-11-11, "Scroll when open") is an opened Inbox, Agent sessions or Timeline row, whose list scrolls inside its card as the paged list requirement states. Hub mode, Inbox, Agent sessions, Timeline, light, room, Nanoleaf, Pixoo, Tidbyt and Wispr cards SHALL show their own compact content. A module card SHALL learn its shape and its card's outer size from the optional `presentation` field of the SDK frontend context, which the dashboard SHALL set only while the card is placed on the unit grid; the field SHALL be additive, so a module that ignores it keeps its full card. A card without compact content of its own SHALL show a generic compact face with its name, current state and an Open link to the existing page that holds its full content and controls; a Pixoo or Tidbyt card whose module does not serve its card, and an unavailable Wispr card, SHALL show the generic face in one unit and SHALL keep their saved shape when the layout is saved. A control hidden by a shape SHALL be reachable one step away. Device-acting controls shown in a shape SHALL behave as in the full card, and the result of a command sent from a shape SHALL show on the card's face. Outside list cards, no offered shape SHALL leave a blank band (above the first content, between two consecutive content boxes, or below the last) taller than 48px or 15% of the card, whichever is larger; a blank placeholder panel is not content. In Inbox, Agent sessions and Timeline, rows SHALL keep their fixed height and sit at the top, with long names cut short on one line so nothing a closed row shows leaves it, and the Timeline SHALL reserve its status line's height so a refresh does not change its page size: a list with more items than one page shows SHALL leave less than one row, plus the pager's reserve, of space below its rows; a shorter list SHALL leave the rest of the card plain; an empty Inbox SHALL show a short centred message. A room or group with no lights SHALL offer Small square and Wide, and SHALL show a saved Tall or Large square as Wide without rewriting the saved shape. In Edit Home the edit bar SHALL hide only the card's own heading under it and SHALL NOT cover a generic face's icon. The built-in layout SHALL show each card in its Standard shape, and the Inbox's Standard shape SHALL be Wide. Art SHALL be cropped to its shape and the music visualizer SHALL fill its shape.

#### Scenario: Every offered shape fits
- **WHEN** each card is placed in each shape it offers at 1100, 1440 and 1920 px
- **THEN** its content height does not exceed the card, no control is cut off and the closed card has no scroll container

#### Scenario: A full list and a short list
- **WHEN** an Inbox with 13 items, and then with one item and with none, is placed in each shape it offers at 1100, 1440 and 1920 px
- **THEN** with 13 items each row keeps its height, no row overlaps the pager and less than one row of space is left above it; one item sits at the top at its normal height with no pager; with none the short message is centred

#### Scenario: An opened session scrolls inside its card
- **WHEN** the owner opens an Agent session in a Large square or Tall card at 1100 or 1440 px
- **THEN** every control in its detail can be scrolled into view and used inside the card, and the counts and filters keep their heights

#### Scenario: Lists stay still while nobody acts
- **WHEN** Home has settled at any width from 1100 to 2560 px with 0, 1, 5, 6 or 13 Inbox items
- **THEN** nothing inside the Inbox, Agent sessions or Timeline card changes for two seconds

#### Scenario: Generic compact face
- **WHEN** a Wemo plug card is a Small square on Home
- **THEN** it shows its name, its current state and Open, which leads to its existing device page with its full controls

#### Scenario: Module cards in every shape
- **WHEN** the Pixoo, Tidbyt and Wispr cards are each placed in each of the four shapes at 1100, 1440 and 1920 px
- **THEN** each shows its module's own compact content for that shape with nothing past the card, no generic face, and nothing inside it changes for two idle seconds

#### Scenario: A command from a compact Pixoo card
- **WHEN** the owner chooses Screen off on a Wide Pixoo card
- **THEN** one power command is sent, as from the full card, and its result shows on the card's face

#### Scenario: A module that cannot draw its card
- **WHEN** a Pixoo card saved as Tall is shown while the Pixoo module does not serve its card
- **THEN** it shows the generic face in one unit, and the next save keeps Tall

#### Scenario: A light in one unit
- **WHEN** a light card is a Small square
- **THEN** it shows its name, state, artwork and On and Off controls, and its options menu leads to the rest of its controls
