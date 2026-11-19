## ADDED Requirements

### Requirement: Hub mode hero on Home

Home SHALL show a fixed hero above its cards (owner decision 5 of epic #1927): a small "Hub mode" label, the synced saved mode as a large word, a Work, Free and Quiet switch and short status chips. The switch SHALL send the same guarded hub mode command, with the same states, as the Hub mode card it replaces: a new request ID and the current selection revision, disabled while a request is pending, stale, not observed or read-only, with refused and uncertain results, Check Inbox and the mode exceptions with their native-difference links shown as before and nothing sent again. The switch SHALL be one keyboard stop where arrow keys, Home and End move between segments without selecting and Enter or Space selects. On the glass layer the selected segment's thumb SHALL be drawn as glass that stretches while it travels, on a time base independent of the display's refresh rate, and SHALL draw no frame once it has settled; without the layer the selected segment SHALL show a plain fill and the switch SHALL work. The chips SHALL show how many lights are on and which plugs are on from the observed device records the shell holds, counting a stale copy, an unavailable device or an unobserved power state as unknown and never as off; the art's forecast notice; Open Gallery; and the art's placement chips. Every chip SHALL take keyboard focus with a visible focus indicator. The hero SHALL be disabled while Home is edited, SHALL send nothing on its own and SHALL take its colors from skin tokens.

#### Scenario: Change the mode from the hero
- **WHEN** the owner moves through the switch with the arrow keys and selects Work with Enter
- **THEN** moving sends nothing, selecting sends one hub mode command with the current revision, the word and the selected segment show Work once the record changes, and the glass thumb stretches on its way and then draws no further frame

#### Scenario: A refused or uncertain change
- **WHEN** the hub mode command is refused, or its reply is lost
- **THEN** the hero shows Not applied or Result unknown with the reason, the saved word is unchanged and the command is not sent again

#### Scenario: The chips follow the observed devices
- **WHEN** a light is switched off, and later the dashboard's copies become stale
- **THEN** the lights chip counts one fewer light on, and while stale the light and plug chips say unknown and the switch is disabled

#### Scenario: Keyboard focus on the chips
- **WHEN** the owner tabs past the switch
- **THEN** each enabled chip takes focus in turn with a visible focus indicator

#### Scenario: Without WebGL 2
- **WHEN** the browser has no WebGL 2
- **THEN** the selected segment has its own plain fill and choosing another mode sends one command and shows it

## MODIFIED Requirements

### Requirement: The approved home with its panels

The home SHALL show its hero above the approved responsive glass grid of reusable agent sessions, Inbox and currently selected device, lighting, room and Music cards. The owner's saved desktop or phone arrangement SHALL override default placement through Edit Home; before the first save the built-in arrangement SHALL include the core panels and existing selected module cards. Timeline SHALL remain accessible. Attention SHALL be highlighted on each agent card with an amber surface and written state, without a separate attention panel. The hero SHALL show the synced saved selection as a large word with explicit Work/Free/Quiet controls, including same-mode reapplication. It SHALL omit routine request sections and device lists; saved choice SHALL remain distinct from device results, with related issues available through its Check Inbox control and shared Inbox evidence. The Inbox card SHALL retain #923's synced failed, uncertain and conflicting operations with expandable evidence and explicit handling controls. An empty synced inbox SHALL say that no commands need handling. Both cards SHALL use reusable presentation over existing shared state and adapters.

#### Scenario: The panels in place
- **WHEN** a signed-in page opens the home with no sessions
- **THEN** the hero shows the Hub mode above a default grid holding the sessions and Inbox without a separate attention panel, and the sessions say none were observed

### Requirement: Module-owned art presentation
The runtime dashboard SHALL expose the shipped art widget and Gallery through its existing authenticated module frontend and card catalog. It SHALL reuse the shell's connection and tracked-command controls, without polling, generated application code or a second persistent catalog. The art frontend SHALL also export a backdrop source that the shell mounts once on Home through the same module frontend scope while the art module runs, and that hands the shell the decoded image of the composition the Art widget would present: its largest still, read once through the existing authenticated content route, with its artwork, composition and rendition identity, size, palette and readiness, and no new route, `data:` or `blob:` URL or pixels outside page memory. With nothing to present or no source mounted, the backdrop SHALL report none without an image and without failing. Gallery browsing SHALL NOT change it. The presentation SHALL retain keyboard focus, touch controls, visible stale/unavailable feedback and captions at desktop and 320/390px widths in both browser appearances.

#### Scenario: Browse art with keyboard and a narrow screen
- **WHEN** the owner opens Gallery, selects a saved composition and operates its explicit controls using the keyboard at 390px
- **THEN** controls and captions remain visible without horizontal overflow, focus is visible and browsing sends no command

#### Scenario: The shell receives the presented artwork
- **WHEN** Home opens with a presented artwork
- **THEN** the backdrop export reports the artwork and composition the Art widget's selection rules choose, ready, decoded from one content request for that composition's largest still, and no request leaves the dashboard origin under the unchanged Content Security Policy

#### Scenario: Nothing to present
- **WHEN** no artwork is available to present, or the art module is not running
- **THEN** the backdrop export reports none with no image, Home renders and nothing throws

### Requirement: Forecast labels bind to actual visible art
The Art frontend SHALL display a deterministic forecast notice only after its opportunity's browser-selection operation succeeded and beside the exact artwork/composition it currently decoded and visibly presents. Reusing the same image ID SHALL NOT substitute for the new selection outcome. The label SHALL say forecast, preserve chance versus likely meaning, identify its time interval and make source freshness available. It SHALL remain separate from the decorative caption and palette. The Art frontend SHALL also export the notice as a compact chip for the shell, stated in the widget's words and bound by the same rules to the artwork the page presents: the visible widget's, or the backdrop rendition the shell reports drawn. Home's hero SHALL show that chip as a link that takes keyboard focus. Loading, an identity mismatch, hidden art, replacement, disabled policy, stale source, expired or unavailable notice evidence SHALL show no current factual label. A browser label SHALL expire at most 30 seconds after the admitted start and before source or forecast validity ends, without automatically restoring an older image. Manual Gallery selection and Home layout pin/dismiss behavior SHALL remain authoritative.

#### Scenario: A stale decode finishes after a new selection
- **WHEN** a forecast opportunity changes while an older rendition is still decoding
- **THEN** neither the obsolete art nor its forecast label replaces the new selection, and no factual label appears before its matching image is visible

#### Scenario: A forecast expires while its image remains
- **WHEN** the notice reaches its stale time while the decorative artwork is still visible
- **THEN** the factual label clears or explicitly reports unavailable evidence while the saved image remains decorative

#### Scenario: The forecast chip on Home
- **WHEN** a scheduled opportunity's browser selection succeeds and Home draws its artwork as the backdrop
- **THEN** the hero shows the chip with the notice's words only from the opportunity's start, bound to that artwork, and clears it when the notice expires while the drawn artwork remains

#### Scenario: The next opportunity reuses the same image
- **WHEN** an already visible image matches a new opportunity but its browser-selection operation is pending, refused or uncertain
- **THEN** the new factual notice remains hidden rather than borrowing evidence from the previous selection
