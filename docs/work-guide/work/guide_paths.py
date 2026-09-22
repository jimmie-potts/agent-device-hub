"""Editorial reading paths. Issue state and scheduling gates are applied at build time."""

PATHS = {
    'local-acceptance': (
        'Control the existing devices from Codex with observed local results.',
        'The scoped local acceptance is complete. Continue with the shared milestone; Pixoo timing experiments remain in the media guide.',
        [],
    ),
    'shared-codex': (
        'One shared task state, consistent device status, and a common integration UI.',
        'The Codex-first milestone is closed. Remaining items here are hardening and recovery follow-ups; choose one only when its evidence and owner are clear.',
        ['H138'],
    ),
    'nanoleaf-devices': (
        'Let Lines and Light Panels share tasks while keeping separate assignments and one writer per device.',
        'The device-state and geometry foundation is delivered. Next, integrate independent device projections through the existing Linux worker; rendering and two-device installation follow.',
        ['N42'],
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
        'Finish the current input qualification review and its missing observations. Local mappings wait for that evidence; shared presets keep their blocked and deferred labels until the owner selects them, now that the general-control definition is closed.',
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
        'The general-control definition is closed, Nanoleaf #64 delivered the native capabilities, and both view candidates are in review: Pixoo under Hub PR #160 and Nanoleaf under Hub PR #162, stacked on the #64 hub companion PR #161. Both hardware acceptances follow their views. Playback and participation policy precede music UI and device effects.',
        ['H151'],
    ),
    'hosting-migrations': (
        'Make runtime ownership and hosting portable without sharing private databases.',
        'The Linux installation and its architecture record are complete. Hosting, dedicated hardware and source moves remain separate deferred choices with separate evidence.',
        [],
    ),
    'assistant-access': (
        'Add approved automation and access methods on top of working controls.',
        'Refine one access or automation path after its prerequisites. Remote Pixoo access has its own sequence; assistant and voice work remain deferred.',
        ['H45', 'P11', 'P17'],
    ),
    'development-workflow': (
        'Keep delivery evidence readable and validation affordable.',
        'Choose the next documentation or tooling task. Prism design comes before its artwork and publication steps; connector repair and shared tooling keep their own scopes.',
        ['H85'],
    ),
}

# These are reviewed independent units, not an automatic list of every issue
# without a native blocker. Their labels and dependencies can withhold a card.
PARALLEL = [
    ('H151', 'Pixoo general controls', 'controls-music',
     'Add the accepted Pixoo controls to the existing component view. Pixoo needs no wire change; the candidate needs human UI approval before merge.'),
    ('N42', 'Nanoleaf runtime worker', 'nanoleaf-devices',
     'Integrate independent device projections through the existing Linux worker on the delivered #41 contract. Its blocked label waits for the owner to release it.'),
    ('P61', 'Pixoo embedded-host performance', 'shared-codex',
     'Measure and improve the delivered embedded host with disposable state. Keep the frozen limits and failed receipts.'),
    ('H15', 'Tidbyt connection findings', 'tidbyt-lifx',
     'Qualify the connection before its controller. Hardware and account trials need their separately scoped authorization.'),
    ('H17', 'LIFX connection findings', 'tidbyt-lifx',
     'Qualify the LAN connection independently of Tidbyt. Its controller and physical acceptance follow its own findings.'),
]
