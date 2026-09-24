"""Issue-specific reading notes. Refresh against owning issue scopes when editing."""

DETAILS = {'H11': 'Deferred Home Assistant and MQTT evaluation.',
 'H123': 'The owner raised the Linux/WSL service RSS budget from 128 to 256 MiB. Re-evaluate '
         'budgets and reduce measured memory use in this backlog follow-up; it does not block Hub '
         '#5. Original failed measurements remain retained; the budget revision is not an '
         'optimization or complete integrated qualification.',
 'H138': 'Add bounded activity/current-turn reset for one task, preserving notices, attention, '
         'labels and other sessions. This does not block Pixoo acceptance and does not control '
         'Codex or devices.',
 'H139': 'Define capture, ordering, retention and inspection guarantees separately from '
         'best-effort current status. The bounded diagnostic journal is not complete history. This '
         'refinement does not block current status, per-task reset or Pixoo acceptance.',
 'H152': 'Pixoo #67 adds user-entered playlist names to the Pixoo integration extension so the '
         'view can label playlists; the UI ships with IDs until then. Hub #152 adds media tools to '
         'the hub MCP device tool set; delivered Hub #151 supplies the view.',
 'H154': 'Hub #151 closed as completed on September 22, 2026 after PR #160 merged as d91bee7 with '
         'three rounds of independent Standards and Specification review, all six PR and '
         'merged-main checks passing and the owner’s approval of the UI candidate. The existing '
         'Pixoo view gains screen power, brightness, saved-playlist selection and the six playback '
         'actions, one guarded controller v1 command each through the existing hub route; playlist '
         'and playback controls are disabled in Monitor with an explicit Media switch through the '
         'Pixoo integration mode operation, because the real controller declares controller v1 '
         'modes unsupported, and nothing restores automatically. Playlists are listed by ID until '
         'Pixoo #67. Source and browser evidence only: nothing is installed or operated, and the '
         'display acceptance is [[H154]] under its own installation permission.',
 'H155': 'Hub #153 closed as completed on September 23, 2026 after PR #162 merged as 50a1c63 with '
         'independent Standards and Specification reviews on every comparison, an accessibility '
         'review whose keyboard-focus finding was fixed and verified in a real browser, all six '
         'Depot checks on the PR head and merged main, and explicit human UI approval recorded on '
         'the PR. The Nanoleaf view offers power, brightness and saved-scene activation on the '
         'capabilities Nanoleaf #64 declares, one guarded controller v1 command each through the '
         'existing hub route: brightness is shown as an override until the next explicit mode '
         'command, scenes are disabled in Work and Quiet or while a mode change is pending with an '
         'explicit Free switch, and scene names come only from the integration snapshot. Nothing '
         'is installed or operated by the source merge; the installed wall is [[H155]].',
 'H175': 'Add the qualified HT-A9 as a second playback source once [[H36]] delivers the Windows '
         'source and hub playback contract.',
 'H178': 'Deferred investigation: qualify finding Apple Music content and requesting a specific '
         'song, album or playlist through the actual player and output path, then propose '
         'implementation issues.',
 'H181': 'Define the reusable application UI foundation and Neon skin template. Coordinate '
         'semantic token names with [[H85]]; that guide/atlas work is independent.',
 'H182': 'Apply the accepted foundation from [[H181]] to the existing dashboard and its B.U.N.N.Y. '
         'display name. Application UI needs approval of its current candidate.',
 'H191': 'Report qualified Codex Desktop read evidence to the shared owner so supported consumers '
         'can clear unread presentation. Read evidence is separate from notice acknowledgment.',
 'H195': 'Expire monitoring sessions after 24 hours without new agent evidence. Release owner '
         'capacity while preserving global settings; new activity creates a fresh entry. This '
         'enables the remaining Tidbyt acceptance checks.',
 'H198': 'Later: replay recorded delivery events without inferring past system or device state.',
 'H199': 'First qualify supported phone-to-app handoff paths, then define owner sign-in and the '
         'outbound connector boundary before building a private task inbox and the first qualified '
         'handoff. This work is deferred behind the anonymous public release.',
 'H20': 'Define selected bulbs, status colors or effects, brightness cap, quiet behavior and '
        'manual-change policy. Consume the shared owner through the delivered LIFX controller '
        'queues.',
 'H201': 'Add an interactive mission map using the existing issue and dependency records, with an '
         'equivalent accessible list. The guide/atlas styling is a prerequisite.',
 'H202': 'Add controlled playback of a documented signal through the atlas. This is an explanatory '
         'walkthrough, not live device telemetry.',
 'H203': 'First qualify supported phone-to-app handoff paths, then define owner sign-in and the '
         'outbound connector boundary before building a private task inbox and the first qualified '
         'handoff. This work is deferred behind the anonymous public release.',
 'H204': 'First qualify supported phone-to-app handoff paths, then define owner sign-in and the '
         'outbound connector boundary before building a private task inbox and the first qualified '
         'handoff. This work is deferred behind the anonymous public release.',
 'H205': 'First qualify supported phone-to-app handoff paths, then define owner sign-in and the '
         'outbound connector boundary before building a private task inbox and the first qualified '
         'handoff. This work is deferred behind the anonymous public release.',
 'H21': 'Finish installed Tidbyt RUN, DONE, stale-feed, rotation and stop observations after '
        '[[H195]] resolves owner capacity and the installed update is verified.',
 'H218': 'Remove confirmed archived Codex Desktop tasks and known children from monitoring. Uses '
         'the session retirement delivered by [[H195]]; does not block Tidbyt acceptance.',
 'H22': 'Install the LIFX status adapter after [[H20]] and verify the agreed behavior on the named '
        'bulbs with separate authorization.',
 'H220': 'Deliver the balanced opening, newly added issues, all open defects, eleven topic guides '
         'and completed-evidence archive, then publish and verify this revision.',
 'H23': 'Implement the connection, then verify the physical transition. The transition also '
        'requires the Tidbyt cloud acceptance baseline.',
 'H24': 'Implement the connection, then verify the physical transition. The transition also '
        'requires the Tidbyt cloud acceptance baseline.',
 'H25': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H26': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H36': 'Qualify and build the Apple Music connector.',
 'H37': 'Add music controls to the shared UI and Codex tools.',
 'H38': 'Add Pixoo/Tidbyt now-playing cards, song-change lighting, and Nanoleaf scene '
        'qualification.',
 'H39': 'Add Pixoo/Tidbyt now-playing cards, song-change lighting, and Nanoleaf scene '
        'qualification.',
 'H40': 'Define per-device music and alert policy. Settle this alongside connector qualification, '
        'before effects take over devices. This is a recommended sequence.',
 'H41': 'Investigate audio capture and visualizers.',
 'H42': 'Hub builds on standalone hosting; Pixoo’s Docker/ARM64 qualification builds on the '
        'completed Pixoo #12 baseline. Coordinate networking, storage, recovery, and packaging.',
 'H44': 'Choose hardware and migration requirements after measuring workloads and portability.',
 'H45': 'Define approved rules that run without an open conversation.',
 'H46': 'Use shared controls and automation tools.',
 'H47': 'Add phone access and tap-to-talk after local delivery.',
 'H48': 'Explore after useful phone access.',
 'H51': 'Qualification follows Hub #50. The controller requires Hub #51 and the completed contract '
        'baseline [[H4]]. Physical acceptance also requires shared automatic status [[H55]] and '
        'lifecycle setup [[H8]].',
 'H52': 'Hub #54 is closed in the refreshed tracker and retained as a reference; this refresh does '
        'not establish adapter or physical acceptance. Qualification and acceptance retain their '
        'owning issues and prerequisites.',
 'H53': 'Qualification follows Hub #50. The controller requires Hub #51 and the completed contract '
        'baseline [[H4]]. Physical acceptance also requires shared automatic status [[H55]] and '
        'lifecycle setup [[H8]].',
 'H55': 'Requires the Corsair controller [[H53]], shared state [[H3]] and its first host [[P31]]. '
        'Strimer participation requires Hub #54; Varmilo requires Hub #61 and a supported '
        'interface. Neither optional adapter gates Corsair status.',
 'H56': 'Requires Hub #53, the completed MCP baseline [[H7]] and general-control definition '
        '[[H31]]. The [[H31]] definition is delivered; refine frontend prerequisites when this '
        'issue is selected. Monitoring policy and optional adapters apply only when selected. This '
        'does not block automatic status or Corsair acceptance.',
 'H57': 'Qualification follows Hub #50. The controller requires Hub #51 and the completed contract '
        'baseline [[H4]]. Physical acceptance also requires shared automatic status [[H55]] and '
        'lifecycle setup [[H8]].',
 'H58': 'Hub #54 is closed in the refreshed tracker and retained as a reference; this refresh does '
        'not establish adapter or physical acceptance. Qualification and acceptance retain their '
        'owning issues and prerequisites.',
 'H60': 'Qualification follows Hub #50. The adapter also requires Hub #53 and the contract '
        'baseline. Acceptance also requires Hub #55 and Hub #8. Start with whole-keyboard shared '
        'agent-status lighting through an existing supported interface.',
 'H61': 'Qualification follows Hub #50. The adapter also requires Hub #53 and the contract '
        'baseline. Acceptance also requires Hub #55 and Hub #8. Start with whole-keyboard shared '
        'agent-status lighting through an existing supported interface.',
 'H62': 'Qualification follows Hub #50. The adapter also requires Hub #53 and the contract '
        'baseline. Acceptance also requires Hub #55 and Hub #8. Start with whole-keyboard shared '
        'agent-status lighting through an existing supported interface.',
 'H65': 'Its inputs [[H63]] and [[H64]] are complete; deferred until selected. Codex mouse '
        'actions: next task needing attention, command menu, previous task and next task. Preserve '
        'ordinary mouse behavior outside Codex and disclose shared-key behavior inside it. '
        'Keyboard A/B and attached Super Buttons are excluded from configuration, dispatch and '
        'preset bindings.',
 'H66': 'Requires [[H65]]. Separately authorize installation, real input and app checks, release '
        'recovery and restoration. This delivery does not require shared device presets.',
 'H67': 'Its inputs are complete: [[H63]], Codex-first milestone [[H32]], general-control '
        'definition [[H31]], standalone host [[H5]], [[N49]] and [[P33]]. Deferred until selected; '
        'define supported actions and participation through existing owners.',
 'H68': 'Requires [[H65]] and [[H67]]. An explicitly selected qualified binding, excluding '
        'keyboard A/B and attached Super Buttons, cycles Work → Free → Quiet → Work through the '
        'hub, with visible requested and partial/failed/uncertain results. Manual dispatch does '
        'not require automation engine [[H45]].',
 'H69': 'Requires [[H68]] and lifecycle setup [[H8]]. Verify selected device results and manual '
        'handoff separately from transport. Additional devices require their own qualification and '
        'acceptance.',
 'H70': 'Requires [[H65]]. Add saved profiles, supported app/hub actions and custom shortcuts for '
        'qualified remappable controls. Keyboard A/B and attached Super Buttons remain excluded. '
        'Local profile editing stays useful without optional preset or Music providers.',
 'H71': 'Requires [[H68]], playback [[H36]] and policy owner [[H40]]. Add presentation '
        'prerequisites [[H38]] and/or [[H39]] only for selected branches. [[H41]] is conditional '
        'on measured-audio effects.',
 'H73': 'Reserved UI evaluation case. Preserve the pinned defective input; this prerequisite '
        'delivery does not repair it or authorize evaluation runs.',
 'H85': 'Restyle the guide and atlas using shared semantic tokens and the Neon skin. Preserve '
        'reduced motion and phone readability; publication stays in [[H87]].',
 'H87': 'Publish and verify the planned mobile guide workspace and atlas after its own '
        'prerequisites. This broader release is separate from the bounded overview publication in '
        '[[H220]].',
 'N10': 'Qualify compatibility; add persistent addressing and inspection mode; integrate '
        'startup/recovery; then evaluate the installed prototype.',
 'N11': 'Qualify compatibility; add persistent addressing and inspection mode; integrate '
        'startup/recovery; then evaluate the installed prototype.',
 'N12': 'Qualify compatibility; add persistent addressing and inspection mode; integrate '
        'startup/recovery; then evaluate the installed prototype.',
 'N13': 'Qualify compatibility; add persistent addressing and inspection mode; integrate '
        'startup/recovery; then evaluate the installed prototype.',
 'N14': 'Qualify compatibility; add persistent addressing and inspection mode; integrate '
        'startup/recovery; then evaluate the installed prototype.',
 'N15': 'Deliver the rendering contract, then the live app renderer.',
 'N16': 'Follow the prototype evaluation, rendering/customization work, and a decision to proceed.',
 'N17': 'Deliver the rendering contract, then the live app renderer.',
 'N18': 'Add project/status palettes after rendering and Hub #2’s vocabulary.',
 'N19': 'Add completion celebrations and status animations after rendering and palettes.',
 'N20': 'Add completion celebrations and status animations after rendering and palettes.',
 'N44': 'After the installed Panels trial, add a selector for Lines or Panels to the existing wall '
        'map. Each device keeps its own settings and targeted controls; the Linux runtime has no '
        'tray.',
 'N46': 'Enroll and trial Panels alongside Lines on the installed Linux runtime using CLI device '
        'targets. Verify visible behavior and scene restoration before the map-selector work; '
        'explicit device authorization is required.',
 'N47': 'Explore a combined layout and allocation pool after the independent-device release is '
        'verified.',
 'N75': 'Qualify task label and project provenance, improve distinguishable fallback names, and '
        'preserve privacy-safe exact-identity matching. Retired sessions must not be recreated by '
        'metadata lookup.',
 'N76': 'Show projects with current retained tasks first and keep saved projects accessible. '
        'Preserve global colors and reservations; the shared owner controls session lifetime.',
 'N77': 'Show at most eight priority task rows by default, with truthful totals and an accessible '
        'full list. Remove duplicate waiting rows without changing task state or acknowledgment.',
 'N78': 'Reduce repeated default controls and status text while preserving access to the wall map '
        'settings and task details.',
 'N81': 'Queue one completion comet when a subagent delays its parent becoming unread. Preserve '
        'restart, replay, stale-evidence and mode rules.',
 'P11': 'Deliver HTTPS LAN access, then browser acceptance. Also requires Pixoo #12’s local '
        'physical baseline.',
 'P13': 'Timezone-aware playlist schedules.',
 'P14': 'Hub builds on standalone hosting; Pixoo’s Docker/ARM64 qualification builds on the '
        'completed Pixoo #12 baseline. Coordinate networking, storage, recovery, and packaging.',
 'P15': 'Playlist portability and UI convenience planning.',
 'P16': 'Qualification of supported transition improvements.',
 'P17': 'Deliver the private MCP connection, then ChatGPT acceptance. Also requires Pixoo #26’s '
        'local acceptance baseline.',
 'P18': 'Authorized cloud-gallery import assessment.',
 'P43': 'Deliver HTTPS LAN access, then browser acceptance. Also requires Pixoo #12’s local '
        'physical baseline.',
 'P44': 'Deliver the private MCP connection, then ChatGPT acceptance. Also requires Pixoo #26’s '
        'local acceptance baseline.',
 'P52': 'Investigate reproduced rapid extra flashes before a still. Explicitly nonblocking for '
        'Pixoo #12; physical work needs separate authorization.',
 'P55': 'Qualify asymmetric visible frame durations with a bounded measurement and control. '
        'Owner-approved deferral from Pixoo #12; preserve the current profile until evidence '
        'supports a change. Physical tests need separate authorization.',
 'P61': 'Later by owner choice. Measure and improve embedded shared-monitor performance under the '
        'existing frozen limits, retaining failed receipts.',
 'P67': 'Pixoo #67 adds user-entered playlist names to the Pixoo integration extension so the view '
        'can label playlists; the UI ships with IDs until then. Hub #152 adds media tools to the '
        'hub MCP device tool set; delivered Hub #151 supplies the view.'}
