"""Reviewed topic boundaries and editorial choices; GitHub owns issue status."""

# id, navigation label, outcome, next action, selected issue references
TOPICS = [
    ('shared-codex', 'Monitoring accuracy and recovery',
     'Keep current activity, read evidence and session lifetime useful across devices.',
     'Session expiration frees capacity before Tidbyt acceptance resumes. Archive removal follows expiration; read evidence and per-task recovery have separate scopes.', ['H195', 'H218', 'H138']),
    ('bunny-controls', 'B.U.N.N.Y. interface and device controls',
     'Make the shared dashboard and device controls consistent and usable.',
     'Define the shared UI foundation before dashboard adoption. Media tools and playlist names have their own scopes; installed control checks remain separate.', ['H181', 'H182', 'P67', 'H152']),
    ('nanoleaf-presentation', 'Nanoleaf wall map and effects',
     'Make current tasks easy to identify and inspect, with truthful light presentation.',
     'Task labels, current projects and a compact inspector can be developed separately with coordinated map edits. Rendering parity and effect customization retain their own prerequisites.', ['N75', 'N76', 'N77', 'N81']),
    ('nanoleaf-devices', 'Adding devices',
     'Extend device support through separate Panels, Tidbyt, LIFX and PC-lighting tracks.',
     'Trial the enrolled Panels with CLI controls before the map selector. Resume Tidbyt acceptance after capacity recovery. Set LIFX status behavior before implementation; PC lighting stays later.', ['N46', 'N44', 'H21', 'H20']),
    ('pixoo-media', 'Pixoo media and playlists',
     'Improve media behavior on the accepted local Pixoo baseline.',
     'Select a media defect or timing investigation when needed. The accepted uniform-frame profile does not establish variable visible timing.', ['P52', 'P55']),
    ('controls-music', 'Music playback and presentation',
     'Connect qualified playback sources before adding music controls and device effects.',
     'This is a later track. Windows playback precedes its AirPlay companion; participation and interruption policy must be settled before music presentation.', ['H36', 'H175', 'H178']),
    ('desktop-controls', 'Shortcuts and desk presets',
     'Keep independent mouse actions separate from shared desk preset coordination.',
     'These choices are deferred. Local Codex shortcuts can resume independently; shared presets retain their own handoff and restoration checks.', ['H65', 'H67']),
    ('work-guide', 'Work guide and system atlas',
     'Make planning, task briefs and system explanations useful on desktop and phone.',
     'Refresh the guide overview and topic organization. Guide/atlas styling, mission-map navigation and signal playback remain separately owned work.', ['H220', 'H85', 'H201', 'H202']),
    ('assistant-access', 'Automation and remote access',
     'Explore approved automation, remote controls and phone-to-app handoffs.',
     'These tracks are deferred. Keep assistant access, remote Pixoo control and native-app handoffs distinct; qualify a supported path before implementing its dependent stages.', ['H45', 'H199']),
    ('hosting-migrations', 'Hosting and migrations',
     'Change hosting or source location without creating competing runtime owners.',
     'Hosting and repository migrations remain later choices. Select one target and preserve explicit ownership and private state boundaries.', []),
    ('development-workflow', 'Engineering maintenance',
     'Keep development tooling and resource use manageable.',
     'Pixoo embedded-host performance is later by owner choice. Select maintenance only for a concrete need; it is not a prerequisite for the current guide or monitoring fixes.', []),
]
PATHS = {key: (outcome, action, selected) for key, _, outcome, action, selected in TOPICS}
ALIASES = {'tidbyt-lifx': 'nanoleaf-devices', 'pc-lighting': 'nanoleaf-devices'}
OWNER_LATER = {'P61': 'Later by owner choice; keep the recorded performance scope and failed measurements.'}
NEXT_STEPS = {
    'H195': 'Release monitoring capacity and let Tidbyt acceptance resume. Implement the 24-hour session lifetime, then verify the installed update separately.',
    'N76': 'Show projects associated with current tasks while keeping saved project settings accessible.',
    'N77': 'Make the task inspector manageable while retaining truthful totals and access to every tracked task.',
    'H181': 'Define the shared UI foundation that dashboard adoption needs.',
    'H85': 'Improve the guide and atlas presentation; coordinate token names with the application foundation.',
}
DECISIONS = {
    'H20': 'Choose status bulbs, colors/effects, brightness cap, quiet behavior and the manual-change policy.',
    'N46': 'Select the installed Panels trial and authorize its device sequence before physical checks.',
    'H154': 'Select and authorize the installed Pixoo general-control trial.',
    'H155': 'Select and authorize the installed Nanoleaf general-control trial.',
}
# Only source-backed, deliberately recorded workaround text belongs here.
WORKAROUNDS = {}

DEVICE_TRACKS = {
    'Panels': ['N44', 'N46', 'N47'],
    'Tidbyt': ['H21', 'H23', 'H24'],
    'LIFX': ['H20', 'H22'],
    'PC lighting': ['H51', 'H52', 'H53', 'H55', 'H56', 'H57', 'H58', 'H60', 'H61', 'H62'],
    'Other integrations': ['H11'],
}
