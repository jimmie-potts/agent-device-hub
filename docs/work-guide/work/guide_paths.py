"""Editorial reading paths. Issue state and scheduling gates are applied at build time."""

PATHS = {
    'local-acceptance': (
        'Control the existing devices from Codex with observed local results.',
        'The scoped local acceptance is complete. Continue with the shared milestone; Pixoo timing experiments remain in the media guide.',
        [],
    ),
    'shared-codex': (
        'One shared task state, consistent device status, and a common integration UI.',
        'The Codex-first milestone is closed. The owner launcher #179 has merged source awaiting closeout, and the style guide #181 is ready; the dashboard styling #182 follows #181. Other items are hardening and recovery follow-ups; choose one only when its evidence and owner are clear.',
        ['H181', 'H138'],
    ),
    'nanoleaf-devices': (
        'Let Lines and Light Panels share tasks while keeping separate assignments and one writer per device.',
        'Device state, the runtime worker and panel effects are delivered in source. The combined wall map #44 comes next, then enrollment #45 and separately authorized installed acceptance #46.',
        ['N44'],
    ),
    'tidbyt-lifx': (
        'Add automatic task status to Tidbyt and LIFX through their own controllers.',
        'The Tidbyt cloud controller source is delivered. Automatic status #19 settles layout, push cadence and rotation with the owner, then installed acceptance #21 follows. LIFX connection qualification #17 remains independent.',
        ['H19', 'H17'],
    ),
    'pc-lighting': (
        'Add Corsair task lighting, with optional Strimer and keyboard support.',
        'Resolve the open documentation gate before selecting qualification. Keep optional devices on separate tracks and retain negative or unknown support findings.',
        ['H50'],
    ),
    'desktop-controls': (
        'Use local Codex mouse shortcuts, then add optional shared desk presets.',
        'N30 qualification is complete. Select and refine the reusable local mapper #65 when this track resumes; shared presets are deferred separately, and keyboard A/B stays outside B.U.N.N.Y.',
        ['H65'],
    ),
    'nanoleaf-presentation': (
        'Make the wall display reflect live state and support configurable presentation.',
        'Reconcile the rendering-contract blocker before the live renderer. External-scene research is complete: externally controlled scenes display as external or unknown. Lively and ambient presentation keep their own qualification sequence.',
        ['N15'],
    ),
    'pixoo-media': (
        'Improve playlists and media behavior on the accepted local Pixoo baseline.',
        'Choose one deferred feature or defect for refinement. Reliability acceptance does not establish transition support or precise visible GIF timing.',
        ['P52', 'P55'],
    ),
    'controls-music': (
        'Extend the shared integration UI into general controls, then music.',
        'The general-control definition, the Nanoleaf native capabilities and both view slices are delivered. The hardware acceptances #154 and #155 follow with their own installation permissions. Choose Pixoo #67 or Hub #152 as companions. The iPhone AirPlay source is qualified; its adapter #175 follows the Windows connector #36. Playback and participation policy precede music UI and device effects.',
        [],
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
    ('P61', 'Pixoo embedded-host performance', 'shared-codex',
     'Measure and improve the delivered embedded host with disposable state. Keep the frozen limits and failed receipts.'),
    ('H19', 'Tidbyt automatic status', 'tidbyt-lifx',
     'Build status on the delivered #16 controller after settling layout, push cadence and rotation with the owner. Installed acceptance #21 needs its own authorization.'),
    ('H17', 'LIFX connection findings', 'tidbyt-lifx',
     'Qualify the LAN connection independently of Tidbyt. Its controller and physical acceptance follow its own findings.'),
]
