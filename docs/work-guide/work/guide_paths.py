"""Reviewed topic boundaries and editorial choices; GitHub owns issue status."""

# id, navigation label, outcome, next action, selected issue references
TOPICS = [
    ('shared-codex', 'Monitoring accuracy and recovery',
     'Keep current activity, read evidence and session lifetime accurate and prompt across devices.',
     'Session expiry and Codex Desktop read state are delivered. Clearing Desktop tasks and Line assignments when sessions end is installed and in review: the archive trial passed, but a non-archive end did not retire its session, and the cause is under investigation. Consistent retirement across Codex and Claude follows it, and Nanoleaf should keep following a feed with an undeclared source. Commit notifications let the dashboard and Nanoleaf react without polling; per-task recovery keeps its own scope.', ['H218', 'H241', 'N111', 'H222']),
    ('bunny-controls', 'B.U.N.N.Y. interface and device controls',
     'Make the shared dashboard and device controls consistent and usable.',
     'The Pixoo and Nanoleaf controls are installed and verified, and one-step apply is delivered. Bound browser-session resources, then share the command lifecycle between forms and actions, in that preferred order. Document controller setup, and fix component aliases that collide with built-in pages. The shared UI foundation precedes dashboard adoption; playlist names and Codex scene tools have their own scopes.', ['H244', 'H245', 'H232', 'H247']),
    ('nanoleaf-presentation', 'Nanoleaf wall map and effects',
     'Make current tasks easy to identify, inspect and open, with truthful light presentation and requested effects.',
     'Codex task titles, current projects first and the compact inspector are delivered. Thread links and the simpler default layout are delivered. The Open in Codex focus fix is in review. The inspector-card merge, whose design is settled, is underway. Next: show the Lines hold, keep comets on skipped revisions and queue the delayed completion comet. Claude Code titles follow the undeclared-source fix and three open decisions; switching between Work and Free by session presence waits for session retirement. Rendering parity and effect customization keep their own prerequisites.', ['N135', 'N112', 'N115', 'N81']),
    ('nanoleaf-devices', 'Adding devices',
     'Extend device support through separate Panels, Tidbyt, LIFX and PC-lighting tracks.',
     'The Lines and Panels trial and Tidbyt agent status are accepted on the installed devices. Add the Lines/Panels map selector; Panels controller and MCP access and an address change without re-enrolling are separate stories. Check stale Tidbyt rows with night mode, and choose LIFX status behavior before implementation. PC lighting stays later.', ['N44', 'N113', 'H227', 'H20']),
    ('pixoo-media', 'Pixoo media and playlists',
     'Improve media behavior on the accepted local Pixoo baseline.',
     'Keep MCP status valid after dashboard uploads, and keep Divoom cloud content off the display after screen-on and reboots. Select a media defect or timing investigation when needed; the accepted uniform-frame profile does not establish variable visible timing.', ['P79', 'P76', 'P52']),
    ('controls-music', 'Music playback and presentation',
     'Connect qualified playback sources before adding music controls and device effects.',
     'Shared playback with the Sony HT-A9 source is delivered and installed. The Sonos Move can join as a second source. Hub-issued play/resume on the Sony is a deferred qualification of its own. Now-playing UI, display cards, lighting and artwork stay deferred; Windows Apple Music and catalog search remain optional.', ['H233', 'H242', 'H37', 'H38']),
    ('desktop-controls', 'Shortcuts and desk presets',
     'Keep independent mouse actions separate from shared desk preset coordination.',
     'These choices are deferred. Local Codex shortcuts can resume independently; shared presets retain their own handoff and restoration checks.', ['H65', 'H67']),
    ('work-guide', 'Work guide and system atlas',
     'Make planning, task briefs and system explanations useful on desktop and phone.',
     'The refreshed overview is published. Restyle the guide and atlas in the Neon skin next; mission-map navigation and signal playback follow the restyle, and the mobile publication waits for it.', ['H85', 'H87', 'H201', 'H202']),
    ('assistant-access', 'Automation and remote access',
     'Explore approved automation, remote controls and phone-to-app handoffs.',
     'These tracks are deferred. Keep assistant access, remote Pixoo control and native-app handoffs distinct; qualify a supported path before implementing its dependent stages.', ['H45', 'H199']),
    ('hosting-migrations', 'Hosting and migrations',
     'Change hosting or source location without creating competing runtime owners.',
     'Run the installed Pixoo app as a user service so B.U.N.N.Y. controls and agent status survive restarts. Retire the Windows Nanoleaf runtime from source and decommission the old Windows installation; Nanoleaf availability follows WSL until hosting moves off it (Nanoleaf ADR 0011, decided). Other hosting and repository migrations remain later choices; select one target and preserve explicit ownership and private state boundaries.', ['P77', 'N131', 'N132']),
    ('development-workflow', 'Engineering maintenance',
     'Keep code structure, development tooling and resource use manageable.',
     'Pixoo embedded-host performance is later by owner choice. The Nanoleaf architecture sequence starts with the bridge.py split; hub merge gates and contract consolidation are separate maintenance, and Pixoo’s typed command observations are preferred before shared SSE delivery. Select maintenance only for a concrete need.', ['N118', 'H240', 'H246', 'P80']),
]
PATHS = {key: (outcome, action, selected) for key, _, outcome, action, selected in TOPICS}
ALIASES = {'tidbyt-lifx': 'nanoleaf-devices', 'pc-lighting': 'nanoleaf-devices'}
OWNER_LATER = {'P61': 'Later by owner choice; keep the recorded performance scope and failed measurements.'}
NEXT_STEPS = {
    'P77': 'Keep the installed Pixoo app running across PC and WSL restarts, so B.U.N.N.Y. controls and agent status return without manual steps.',
    'N111': 'Keep the wall following the hub feed when a session comes from an undeclared source, so the first Claude Code session cannot stop it.',
    'H244': 'Release each retired B.U.N.N.Y. browser session’s resources through one cleanup path.',
    'H222': 'Announce each hub commit to change-stream readers at once; Nanoleaf can then stop polling every second.',
    'H181': 'Define the shared UI foundation that dashboard adoption needs.',
    'H85': 'Improve the guide and atlas presentation; coordinate token names with the application foundation.',
}
DECISIONS = {
    'H20': 'Choose status bulbs, colors/effects, brightness cap, quiet behavior and the manual-change policy.',
    'H227': 'Record the intended night-mode settings, then decide whether stale Tidbyt rows need a renderer change.',
    'N100': 'Choose which Claude Code home to read, which working folder counts when a session moves, and the fallback when a session has no title.',
}
# Only source-backed, deliberately recorded workaround text belongs here.
WORKAROUNDS = {}

DEVICE_TRACKS = {
    'Panels': ['N44', 'N47', 'N113', 'N114'],
    'Tidbyt': ['H227', 'H23', 'H24'],
    'LIFX': ['H20', 'H22'],
    'PC lighting': ['H51', 'H52', 'H53', 'H55', 'H56', 'H57', 'H58', 'H60', 'H61', 'H62'],
    'Other integrations': ['H11'],
}
MAINTENANCE_TRACKS = {
    'Hub': ['H240', 'H246', 'H123'],
    'Nanoleaf': ['N118', 'N127', 'N120', 'N121', 'N119', 'N122', 'N128', 'N129', 'N130'],
    'Pixoo': ['P80', 'P81', 'P82', 'P61'],
}
# Guides whose remaining work is split under track headings; tracks cover each guide exactly.
GUIDE_TRACKS = {'nanoleaf-devices': DEVICE_TRACKS, 'development-workflow': MAINTENANCE_TRACKS}
