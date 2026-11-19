## ADDED Requirements

### Requirement: Home on a clear glass layer

Home SHALL draw the presented artwork unblurred behind the page, continuing behind the rail, which SHALL be frosted, and every Home card on flat, transparent glass with a thin bevel, a soft shadow and a rim, where neighboring panels lean together. With no image to draw (nothing presented, the first image still loading or unavailable, or the art module stopped), the backdrop SHALL be the Quiet glass wash and the glass SHALL still be drawn. Each card's glass SHALL follow its box through scrolling, resizing, Edit Home and paging. The layer SHALL draw only while something changes or settles, SHALL draw no frame at rest, SHALL cap the pixel ratio at 2 and SHALL release its context when Home is left. Text on the glass and the page heading SHALL keep at least 4.5:1 contrast against what is drawn behind it in light and dark appearance. Without WebGL 2, or after the context is lost, Home SHALL show its Quiet glass panels with every control working. The layer SHALL take no pointer input and SHALL send no command, sync or request; its colors SHALL come from skin tokens and it SHALL use no `data:` or `blob:` image.

#### Scenario: Artwork backdrop
- **WHEN** Home opens while an artwork is presented
- **THEN** the artwork fills the window behind the cards and the rail, each card is drawn on glass over it, and the card surfaces are see-through

#### Scenario: Glass follows the boxes
- **WHEN** the operator scrolls, resizes the window, moves or reshapes a card in Edit Home, or pages a list that changes a card's height
- **THEN** each card's glass is redrawn at the card's new box

#### Scenario: At rest
- **WHEN** nothing on Home changes after the first appearance has settled
- **THEN** the layer draws no frame

#### Scenario: No WebGL 2 or a lost context
- **WHEN** the browser has no WebGL 2, or the layer's context is lost
- **THEN** every card shows its Quiet glass panel over the Quiet glass wash, every control works, and a restored context draws the glass again

#### Scenario: Readable text over any artwork
- **WHEN** a dark or a bright artwork is presented in light or dark appearance
- **THEN** the text on each panel and the page heading measures at least 4.5:1 against the pixels behind it
