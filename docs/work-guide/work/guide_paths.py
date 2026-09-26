"""Reviewed topic boundaries and editorial choices; GitHub owns issue status."""

# id, navigation label, outcome, next action, selected issue references
TOPICS = [
    ('shared-codex', 'Monitoring accuracy and recovery',
     'Keep current activity, read evidence and session lifetime accurate and prompt across devices.',
     "Session expiry, Codex Desktop read state, consistent retirement across Codex and Claude, the undeclared-source fix and commit notifications are delivered. Next: record each session's observed model and thinking level, and install the Claude Code producer on the WSL host. Qualifying session ends on the installed hub and Codex Desktop SessionEnd follow. Evicting a task on every device and waking the Nanoleaf worker from the change stream no longer wait on a prerequisite, but they keep blocked labels. Per-task recovery keeps its own scope.", ['H305', 'H306', 'H367', 'H253']),
    ('bunny-controls', 'B.U.N.N.Y. interface and device controls',
     'Make the shared dashboard and device controls consistent and usable.',
     "B.U.N.N.Y. is the one shell (ADR 0007). The Neon skin, one-step apply, bounded browser sessions and one command lifecycle are delivered. Next: open it from a bookmark, make the home a dense widget grid, port the wall map's Prism renderer as shared device art, and show controls for the Panels' read-only snapshot. Document controller setup and fix component aliases that collide with built-in pages. Device pages and the group page follow the built home.", ['H276', 'H277', 'H355', 'H323', 'H247']),
    ('nanoleaf-presentation', 'Nanoleaf wall map and effects',
     'Make current tasks easy to identify, inspect and open, with truthful light presentation and requested effects.',
     "Codex task titles, current projects first and the compact inspector are delivered. Thread links, the simpler default layout, the Open in Codex focus fix, the merged inspector card and configurable Work-mode colors are delivered. Next: show the Lines hold, keep comets on skipped revisions and queue the delayed completion comet. Claude Code titles wait on three open decisions. Switching between Work and Free by session presence no longer waits on session retirement, but it keeps a blocked label. Saved-scene playback and requested animations through MCP are delivered; stopping an animation and restoring the remembered scene through MCP is ready. The wall map stays Nanoleaf's advanced editor (ADR 0007), so new editing controls land in B.U.N.N.Y.", ['N112', 'N115', 'N81', 'N150']),
    ('nanoleaf-devices', 'Adding devices',
     'Extend device support through separate Lines and Panels, wall map retirement, Tidbyt, LIFX, PC-lighting and other-integration tracks.',
     'The Lines and Panels trial and Tidbyt agent status are accepted on the installed devices. The map selector, Panels control through the controller and MCP, and address changes without re-enrolling are delivered. The local controller host for Tidbyt and LIFX is installed. Next: install the Panels in the controller, MCP host and hub, which waits on the hub starting with a sixth controller, and expose wall geometry read-only so B.U.N.N.Y. can draw it (ADR 0007). The remaining wall-map operations then move behind the integration extension before the wall map retires; the wall-map scene picker predates ADR 0007 and joins that parity list. Choose LIFX status behavior before implementation, and check stale Tidbyt rows with night mode. PC lighting stays later.', ['N169', 'N170', 'H20', 'H227']),
    ('pixoo-media', 'Pixoo media and playlists',
     'Improve media behavior on the accepted local Pixoo baseline.',
     'Keep MCP status valid after dashboard uploads, and keep Divoom cloud content off the display after screen-on and reboots; disconnecting the Pixoo from the Divoom cloud is an owner network step with its own receipts. Now-playing cards are installed and checked on the display. The media catalog, playlist items and previews through the integration extension feed the B.U.N.N.Y. Pixoo page. Select a media defect or timing investigation when needed; the accepted uniform-frame profile does not establish variable visible timing.', ['P79', 'P76', 'P96', 'P52']),
    ('controls-music', 'Music playback and presentation',
     'Connect qualified playback sources before adding music controls and device effects.',
     'Shared playback with the Sony HT-A9 source is installed. Now-playing with Sony-qualified controls in B.U.N.N.Y. and Codex tools, and now-playing cards on the Pixoo and Tidbyt, are installed and checked. The Sony cannot resume from the hub, so the Sonos Move is the next source and the qualified route to play and resume. Keeping the displays working when the selected source changes follows it. Artwork, song-change lighting and visualizers stay deferred; Windows Apple Music and catalog search remain optional.', ['H233', 'H331']),
    ('desktop-controls', 'Shortcuts and desk presets',
     'Keep independent mouse actions separate from shared desk preset coordination.',
     'Desk presets with fixed Work, Free and Quiet mappings are the smallest visible cross-device win and the base for coordinated looks; the owner still has to select them. Local Codex shortcuts can resume independently, and shared presets keep their own handoff and restoration checks. The command palette and the home widget catalog build on the B.U.N.N.Y. home.', ['H67', 'H65', 'H366']),
    ('work-guide', 'Work guide and system atlas',
     'Make planning, task briefs and system explanations useful on desktop and phone.',
     'The Neon restyle, mobile publication, circuit trace, starting-session recommendations, story-owned topic placement and the Ideas section are delivered. Next: reconcile story text made stale by the 2026-09-25 deliveries, record recommendations for the stories filed since, then refresh the guide nightly into one rolling pull request with retired-term warnings. Mission-map navigation, signal playback and the trading-card skin keep blocked labels.', ['H311', 'H341', 'H315', 'H316']),
    ('assistant-access', 'Automation and remote access',
     'Explore approved automation, remote controls and phone-to-app handoffs.',
     'Hub moments are decided (ADR 0006), and controller contract 1.1 carries the moment command. Next: send moments through contract 1.1, then store event rules and the interrupt set and arbitrate the moments they trigger. Separately, keep the hub starting as its MCP tool catalog grows; that defect blocks the Panels installation. Scheduled routines and Automation widgets follow. The conversational assistant, phone access, remote Pixoo control and native-app handoffs stay deferred; qualify a supported path before implementing its dependent stages.', ['H358', 'H335', 'H357', 'H45']),
    ('hosting-migrations', 'Hosting and migrations',
     'Change hosting or source location without creating competing runtime owners.',
     'The Pixoo app runs as a user service, and the Windows Nanoleaf runtime is retired and decommissioned. ADR 0008 keeps the runtime in WSL: start it at boot with linger, an idle timeout and one scheduled task, and install stop-signal handlers so services stop cleanly. Docker on the PC is not adopted. The dedicated Linux server carries the Docker packaging and starts only on its trigger. An upgrade and rollback command would replace the manual Linux runtime upgrade. Repository migrations remain later choices that preserve explicit ownership and private state.', ['H356', 'H361', 'N140']),
    ('development-workflow', 'Engineering maintenance',
     'Keep code structure, development tooling and resource use manageable.',
     'Pixoo embedded-host performance is later by owner choice. The Nanoleaf architecture sequence starts with the bridge.py split; hub merge gates and contract consolidation are separate maintenance, and Pixoo’s typed command observations are preferred before shared SSE delivery. The dashboard browser flake is in progress and the slow-device isolation check is ready. Select maintenance only for a concrete need.', ['H303', 'H263', 'N118', 'H240', 'P80']),
]
PATHS = {key: (outcome, action, selected) for key, _, outcome, action, selected in TOPICS}
ALIASES = {'tidbyt-lifx': 'nanoleaf-devices', 'pc-lighting': 'nanoleaf-devices'}

DEVICE_TRACKS = {
    'Lines and Panels': ['N47', 'N167', 'N168', 'N161'],
    'Wall map retirement': ['N169', 'N170', 'N171'],
    'Tidbyt': ['H227', 'H23', 'H24'],
    'LIFX': ['H20', 'H22', 'H319', 'H320', 'H327', 'H337'],
    'PC lighting': ['H51', 'H52', 'H53', 'H55', 'H56', 'H57', 'H58', 'H60', 'H61', 'H62'],
    'Roborock': ['H376', 'H377'],
    'Other integrations': ['H11'],
}
MAINTENANCE_TRACKS = {
    'Hub': ['H240', 'H246', 'H123', 'H258', 'H263', 'H303', 'H309', 'H310', 'H314'],
    'Nanoleaf': ['N118', 'N127', 'N120', 'N121', 'N119', 'N122', 'N128', 'N129', 'N130', 'N162', 'N163'],
    'Pixoo': ['P80', 'P81', 'P82', 'P61', 'P86'],
}
# Guides whose remaining work is split under track headings; tracks cover each guide exactly.
GUIDE_TRACKS = {'nanoleaf-devices': DEVICE_TRACKS, 'development-workflow': MAINTENANCE_TRACKS}
