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
 'H178': 'Deferred investigation: qualify finding Apple Music content and requesting a specific '
         'song, album or playlist through the actual player and output path, then propose '
         'implementation issues.',
 'H181': 'Define the reusable application UI foundation and Neon skin template. Coordinate '
         'semantic token names with [[H85]]; that guide/atlas work is independent.',
 'H182': 'Apply the accepted foundation from [[H181]] to the existing dashboard and its B.U.N.N.Y. '
         'display name. Application UI needs approval of its current candidate.',
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
 'H218': 'Remove confirmed archived Codex Desktop tasks and known children from monitoring. Uses '
         'the session retirement delivered by [[H195]] and the Codex home configured for [[H191]].',
 'H22': 'Install the LIFX status adapter after [[H20]] and verify the agreed behavior on the named '
        'bulbs with separate authorization.',
 'H222': 'Announce each state commit to change-stream readers at once instead of on a 1-second '
         'timer. Covers every commit source, including hook ingest and the Desktop read-state '
         'reader. Nanoleaf [[N90]] consumes it.',
 'H227': 'The [[H21]] owner check found stale Tidbyt rows and their ? marker hard to read, with '
         'night mode on and device brightness low. Assess readability with the intended night-mode '
         'settings before changing the renderer.',
 'H229': 'Optional artwork from the Sony source through the shared playback service. Text-only '
         'now-playing ([[H37]], [[H38]]) and basic lighting ([[H39]]) do not wait for it.',
 'H23': 'Implement the Tronbyt connection, then verify the physical transition in [[H24]]. The '
        'Tidbyt cloud baseline [[H21]] is accepted.',
 'H232': 'Document how to connect installed device controllers to BUNNY in the hub setup guide; '
         'the installed hub had no controllers configured, and the coordinator worked out the '
         'steps from source.',
 'H233': 'Add the Sonos Move, qualified in [[H158]], as a second playback source. One selected '
         'source drives the snapshot and commands; an unavailable source is shown, never swapped '
         'silently.',
 'H24': 'Implement the connection in [[H23]], then verify the physical transition. The Tidbyt '
        'cloud baseline [[H21]] is accepted.',
 'H25': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H26': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H36': 'Optional Windows Apple Music source. Revisit once the Sony path from [[H175]] proves '
        'useful; it is not a prerequisite for the other music stories.',
 'H37': 'Text-only now-playing and the Sony-qualified controls (pause, next, previous) in BUNNY '
        'and Codex tools, using shared playback from [[H175]]. BUNNY sessions need a small hub '
        'change to read the playback source.',
 'H38': 'Readable track and artist cards on Pixoo and Tidbyt from the shared playback snapshot, '
        'rendered by each display’s controller. Artwork from [[H229]] is optional.',
 'H39': 'Song-change lighting and Nanoleaf music-scene qualification from the shared playback '
        'snapshot. Select effect mappings, policy inputs and acceptance targets first.',
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
 'H51': 'Qualify Corsair RAM and H150i lighting through iCUE. Its documentation prerequisite '
        '[[H50]] is complete; the Corsair controller [[H53]] builds on this qualification.',
 'H52': 'Hub #54 is closed in the refreshed tracker and retained as a reference; this refresh does '
        'not establish adapter or physical acceptance. Qualification and acceptance retain their '
        'owning issues and prerequisites.',
 'H53': 'Implement the Corsair controller after qualification [[H51]], on the completed contract '
        'baseline [[H4]].',
 'H55': 'Requires the Corsair controller [[H53]]; shared state [[H3]] and its first host [[P31]] '
        'are delivered. Strimer ([[H58]]) and Varmilo ([[H61]]) participation are optional and do '
        'not gate Corsair status.',
 'H56': 'Requires Hub #53, the completed MCP baseline [[H7]] and general-control definition '
        '[[H31]]. The [[H31]] definition is delivered; refine frontend prerequisites when this '
        'issue is selected. Monitoring policy and optional adapters apply only when selected. This '
        'does not block automatic status or Corsair acceptance.',
 'H57': 'Install and verify Corsair status and restoration after shared automatic status [[H55]], '
        'using the delivered lifecycle setup [[H8]].',
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
 'H71': 'Requires [[H68]], shared playback [[H175]] and policy owner [[H40]]. Add presentation '
        'prerequisites [[H38]] and/or [[H39]] only for selected branches. [[H41]] is conditional '
        'on measured-audio effects.',
 'H73': 'Reserved UI evaluation case. Preserve the pinned defective input; this prerequisite '
        'delivery does not repair it or authorize evaluation runs.',
 'H85': 'Restyle the guide and atlas using shared semantic tokens and the Neon skin. Preserve '
        'reduced motion and phone readability; publication stays in [[H87]].',
 'H87': 'Publish and verify the planned mobile guide workspace and atlas after the [[H85]] '
        'restyle. This broader release is separate from the overview publication delivered in '
        '[[H220]].',
 'N131': 'Delete the Windows installer, tray, WSL forwarding and MCP helper from source, supersede the '
         'Windows clauses of ADRs 0005 to 0007 and update the three affected specifications. Shares '
         'bridge.py with [[N118]].',
 'N132': 'Owner task on the PC: archive or delete the retired Windows installation and its token copy, '
         'prune stale worktree registrations and Codex trust entries. Independent of [[N131]].',
 'H240': 'Define enforceable hub merge gates for one maintainer with the guide-only CI exception; '
         'finish with a reviewable configuration proposal.',
 'H241': 'Apply one shared-owner retirement rule to Codex Desktop, Codex CLI and Claude Code '
         'sessions when a runtime.ended notice is accepted.',
 'H242': 'Qualify resuming a paused AirPlay session through the Sony source module; expose '
         'play/resume only if the receiver supports it.',
 'H244': 'Release each retired browser session\'s resources and centralize retirement cleanup so '
         'repeated BUNNY opens do not leak.',
 'H245': 'Give BUNNY forms and one-click actions one command lifecycle so receipt, uncertainty and '
         'refresh fixes apply consistently.',
 'H246': 'Reduce the places that change when a Pixoo or Nanoleaf integration contract changes, '
         'keeping both native protocols.',
 'N110': 'Enter Work while the selected shared owner has monitored sessions and Free when the last '
         'one ends; opt-in per device.',
 'N111': 'Stop rejecting a whole hub snapshot because one session comes from an undeclared source; '
         'keep following the feed.',
 'N112': 'Show the Lines hold, its cause and a Resume action in the wall map and CLI status; '
         'nothing retries automatically.',
 'N113': 'Reach the NL22 Panels through the protected controller and local MCP, which today '
         'address only the Lines.',
 'N114': 'Change a registered device\'s address after a new lease without re-enrolling; keep id, '
         'reservations, mode, layout and scene.',
 'N115': 'Stop treating every skipped owner revision as a resync so completion comets and waves '
         'survive.',
 'N117': 'Keep keyboard focus on Open in Codex through an unchanged state poll instead of moving '
         'it to the Tasks heading.',
 'N118': 'Split bridge.py: shared configuration operations first, then hook management and runtime '
         'primitives; stop passing the bridge module as a value.',
 'N119': 'Decide DOM rebuilds in one scheduler behind a view model; renderers only draw. UI PR, '
         'human approval applies.',
 'N120': 'Keep SQLite schema knowledge with the modules that own each table. Follows [[N118]].',
 'N121': 'Carry device identity as a worker context instead of a threaded parameter and '
         'primary-device branches. Follows [[N118]].',
 'N122': 'Bounded investigation: can the shared-input projection be a pure function tested without '
         'SQLite?',
 'N123': 'Decide whether the standard SVG wall stays as a fallback for Prism or a missing Prism '
         'asset becomes an installation error.',
 'N124': 'Record a real rendering-cost baseline for the wall map in Edge on the PC; needs the '
         'hardware.',
 'N127': 'Build one explicit device-render input per worker pass, separate from credentials, paths '
         'and transport.',
 'N128': 'Investigate making wall-state construction a pure read projection with explicit refresh '
         'and cache owners.',
 'N129': 'Investigate one owner for worker transaction boundaries, validity checks and '
         'transmission journaling.',
 'N130': 'Measure whether shared SQLite write-lock windows block enough to justify shorter '
         'transactions.',
 'N133': 'Decided 2026-09-24: no Windows-side launcher; availability follows WSL until hub hosting '
         '([[H42]] or [[H44]]). ADR 0011 records it.',
 'N135': 'Show one context card for the selected Line or task with only the controls that act in '
         'that context; rethink reservation and override controls.',
 'P79': 'Accept dashboard transport evidence in the MCP status schema so status stays valid after '
        'uploads.',
 'P80': 'Share typed operation metadata between command producers and observers so changes '
        'surface during typechecking.',
 'P81': 'Give SSE client queueing, credential rechecks, heartbeat and cleanup one implementation '
        'while keeping browser and native feed contracts.',
 'N100': 'Show Claude Code titles and projects for shared tasks, as [[N75]] does for Codex. The '
         'hub feed deliberately carries neither, so the wall reads them locally by session ID.',
 'N16': 'Follow the prototype evaluation, rendering/customization work, and a decision to proceed.',
 'N17': 'The rendering contract [[N15]] is delivered. Build the live app renderer on it; the Lively '
        'prototype was closed as superseded.',
 'N18': 'Add project/status palettes after rendering and Hub #2’s vocabulary.',
 'N19': 'Add completion celebrations and status animations after rendering and palettes.',
 'N20': 'Add completion celebrations and status animations after rendering and palettes.',
 'N44': 'The installed Lines and Panels trial [[N46]] is accepted. Add a selector for Lines or '
        'Panels to the existing wall map; each device keeps its own settings and targeted '
        'controls.',
 'N47': 'Explore a combined layout and allocation pool now that the independent-device trial '
        '[[N46]] is verified; resolve its design choices with the owner first.',
 'N81': 'Queue one completion comet when a subagent delays its parent becoming unread. Preserve '
        'restart, replay, stale-evidence and mode rules.',
 'N90': 'Wake the Nanoleaf worker from the hub change stream instead of its 1-second poll. Waits '
        'for [[H222]]; the worker keeps its single device writer.',
 'N91': 'Let Codex list saved Nanoleaf scenes and play one through the local MCP server. The '
        'controller already activates discovered scenes in Free mode ([[N64]]); MCP exposes only '
        'status and mode today.',
 'N92': 'Let Codex describe an animation that plays on the Lines through the local MCP server, '
        'reusing the worker’s existing effect upload and single writer. Controller v1 has no '
        'animation command yet.',
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
 'P67': 'Add user-entered playlist names to the Pixoo integration extension, so BUNNY and the hub '
        'MCP media tools ([[H152]]) can label playlists. They show playlist IDs until then.',
 'P76': 'Keep Divoom cloud content off the Pixoo after screen-on and device reboots, and document '
        'owner actions that cut the device off from Divoom’s cloud. Found during [[H154]].',
 'P77': 'Run the installed Pixoo app as a user service with the settings the hub needs, so BUNNY '
        'controls and agent status return after PC or WSL restarts. Found during [[H154]].'}
