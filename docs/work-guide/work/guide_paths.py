"""Editorial reading paths. Issue state and scheduling gates are applied at build time."""

PATHS = {
    'local-acceptance': (
        'Control the existing devices from Codex with observed local results.',
        'The scoped local acceptance is complete. Continue with the shared milestone; Pixoo timing experiments remain in the media guide.',
        [],
    ),
    'shared-codex': (
        'One shared task state, consistent device status, and a common integration UI.',
        'Reconcile Hub #32 against its delivered source and installed receipts. Its milestone checklist and blocked label are still open; inspect the remaining criteria before choosing more implementation.',
        ['H32'],
    ),
    'nanoleaf-devices': (
        'Let Lines and Light Panels share tasks while keeping separate assignments and one writer per device.',
        'Start with the device-state and geometry foundation. Worker and rendering work follow that contract; two-device installation comes last.',
        ['N41'],
    ),
    'tidbyt-lifx': (
        'Add automatic task status to Tidbyt and LIFX through their own controllers.',
        'Qualify each connection separately. The two investigations can run in parallel; each controller waits for its own findings.',
        ['H15', 'H17'],
    ),
    'pc-lighting': (
        'Add Corsair task lighting, with optional Strimer and keyboard support.',
        'Resolve the open documentation gate before selecting qualification. Keep optional devices on separate tracks and retain negative or unknown support findings.',
        ['H50'],
    ),
    'desktop-controls': (
        'Use local Wispr and Codex shortcuts, then add optional shared desk presets.',
        'Finish the current input qualification review and its missing observations. Local mappings wait for that evidence; shared presets also wait for the Codex milestone and general-control definition.',
        ['H64'],
    ),
    'nanoleaf-presentation': (
        'Make the wall display reflect live state and support configurable presentation.',
        'Reconcile the rendering-contract blocker before the live renderer. External-scene research is a separate option; Lively and ambient presentation keep their own qualification sequence.',
        ['N15', 'N21'],
    ),
    'pixoo-media': (
        'Improve playlists and media behavior on the accepted local Pixoo baseline.',
        'Choose one deferred feature or defect for refinement. Reliability acceptance does not establish transition support or precise visible GIF timing.',
        ['P52', 'P55'],
    ),
    'controls-music': (
        'Extend the shared integration UI into general controls, then music.',
        'Finish the Codex milestone before refining general controls. Playback and participation policy precede music UI and device effects.',
        ['H31'],
    ),
    'hosting-migrations': (
        'Make runtime ownership and hosting portable without sharing private databases.',
        'Reconcile the Linux installation record before the Hub adoption document. Hosting, dedicated hardware and source moves are separate choices with separate evidence.',
        ['N55', 'H43'],
    ),
    'assistant-access': (
        'Add approved automation and access methods on top of working controls.',
        'Refine one access or automation path after its prerequisites. Remote Pixoo access has its own sequence; assistant and voice work remain deferred.',
        ['H45', 'P11', 'P17'],
    ),
    'development-workflow': (
        'Keep delivery evidence readable and validation affordable.',
        'Finish this guide clarity update. Prism styling, connector repair and shared tooling remain separately scoped work.',
        ['H148'],
    ),
}

# These are reviewed independent units, not an automatic list of every issue
# without a native blocker. Their labels and dependencies can withhold a card.
PARALLEL = [
    ('N41', 'Nanoleaf device foundation', 'nanoleaf-devices',
     'Own the Nanoleaf storage and geometry contract. Use isolated source fixtures; worker integration follows this story.'),
    ('P61', 'Pixoo embedded-host performance', 'shared-codex',
     'Measure and improve the delivered embedded host with disposable state. Keep the frozen limits and failed receipts.'),
    ('H15', 'Tidbyt connection findings', 'tidbyt-lifx',
     'Qualify the connection before its controller. Hardware and account trials need their separately scoped authorization.'),
    ('H17', 'LIFX connection findings', 'tidbyt-lifx',
     'Qualify the LAN connection independently of Tidbyt. Its controller and physical acceptance follow its own findings.'),
]
