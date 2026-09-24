"""Reviewed topic boundaries and editorial choices; GitHub owns issue status."""

# id, navigation label, outcome, next action, selected issue references
TOPICS = [
    ('shared-codex', 'Monitoring accuracy and recovery',
     'Keep current activity, read evidence and session lifetime accurate and prompt across devices.',
     'Session expiry and Codex Desktop read state are delivered. Archive removal can start now; retire ended sessions consistently across Codex and Claude, and let Nanoleaf keep following a feed with an undeclared source. Commit notifications let the dashboard and Nanoleaf react without polling; per-task recovery keeps its own scope.', ['H218', 'H222', 'N90', 'H138']),
    ('bunny-controls', 'B.U.N.N.Y. interface and device controls',
     'Make the shared dashboard and device controls consistent and usable.',
     'The Pixoo and Nanoleaf controls are installed and verified, and one-step apply is delivered. Share the command lifecycle between forms and actions, and document controller setup. The shared UI foundation precedes dashboard adoption; playlist names and Codex scene tools have their own scopes.', ['H245', 'H232', 'H181', 'P67']),
    ('nanoleaf-presentation', 'Nanoleaf wall map and effects',
     'Make current tasks easy to identify, inspect and open, with truthful light presentation and requested effects.',
     'Codex task titles, current projects first and the compact inspector are delivered. Thread links and the simpler default layout are delivered. Next: keep Open in Codex focus through polling, merge the inspector cards, show the Lines hold, and keep comets on skipped revisions; Claude Code titles can follow. Rendering parity and effect customization keep their own prerequisites.', ['N117', 'N135', 'N100', 'N81']),
    ('nanoleaf-devices', 'Adding devices',
     'Extend device support through separate Panels, Tidbyt, LIFX and PC-lighting tracks.',
     'The Lines and Panels trial and Tidbyt agent status are accepted on the installed devices. Add the Lines/Panels map selector, check stale Tidbyt rows with night mode, and choose LIFX status behavior before implementation. PC lighting stays later.', ['N44', 'H227', 'H20']),
    ('pixoo-media', 'Pixoo media and playlists',
     'Improve media behavior on the accepted local Pixoo baseline.',
     'Keep Divoom cloud content off the display after screen-on and reboots. Select a media defect or timing investigation when needed; the accepted uniform-frame profile does not establish variable visible timing.', ['P76', 'P52', 'P55']),
    ('controls-music', 'Music playback and presentation',
     'Connect qualified playback sources before adding music controls and device effects.',
     'Shared playback with the Sony HT-A9 source is delivered and installed. The Sonos Move can join as a second source. Now-playing UI, display cards, lighting and artwork stay deferred; Windows Apple Music and catalog search remain optional.', ['H233', 'H37', 'H38', 'H229']),
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
     'Run the installed Pixoo app as a user service so BUNNY controls and agent status survive restarts. Retire the Windows Nanoleaf runtime from source and decommission the old Windows installation; Nanoleaf availability follows WSL until hosting moves off it (Nanoleaf ADR 0011, decided). Other hosting and repository migrations remain later choices; select one target and preserve explicit ownership and private state boundaries.', ['P77', 'N131']),
    ('development-workflow', 'Engineering maintenance',
     'Keep development tooling and resource use manageable.',
     'Pixoo embedded-host performance is later by owner choice. The Nanoleaf architecture sequence starts with the bridge.py split; hub merge gates and contract consolidation are separate maintenance. Select maintenance only for a concrete need.', ['N118']),
]
PATHS = {key: (outcome, action, selected) for key, _, outcome, action, selected in TOPICS}
ALIASES = {'tidbyt-lifx': 'nanoleaf-devices', 'pc-lighting': 'nanoleaf-devices'}
OWNER_LATER = {'P61': 'Later by owner choice; keep the recorded performance scope and failed measurements.'}
NEXT_STEPS = {
    'P77': 'Keep the installed Pixoo app running across PC and WSL restarts, so BUNNY controls and agent status return without manual steps.',
    'H218': 'Drop archived Codex Desktop tasks from monitoring, now that session expiry is delivered.',
    'H222': 'Announce each hub commit to change-stream readers at once; Nanoleaf can then stop polling every second.',
    'H181': 'Define the shared UI foundation that dashboard adoption needs.',
    'H85': 'Improve the guide and atlas presentation; coordinate token names with the application foundation.',
}
DECISIONS = {
    'H20': 'Choose status bulbs, colors/effects, brightness cap, quiet behavior and the manual-change policy.',
    'H227': 'Record the intended night-mode settings, then decide whether stale Tidbyt rows need a renderer change.',
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
