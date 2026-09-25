"""Issue-specific reading notes. Refresh against owning issue scopes when editing."""

DETAILS = {'H267': 'Backlog placeholder: coordinate Work, Free and Quiet colors and scenes across every device from the hub, building on [[H67]].',
 'H252': "Show each story's starting session, model and thinking level in the guide from its saved Execution recommendation.",
 'H253': 'Qualify when installed Codex Desktop emits SessionEnd for a task that is not archived, and check removal, reopen and new work afterward.',
 'H254': 'Add a second, trading-card skin to the guide and atlas, with art shared by issue label and a skin picker.',
 'H258': 'Report documentation drift against pinned sources and documented commands in CI, as warnings rather than a merge gate.',
 'H259': "Move topic assignments and reading notes into the stories and read them live. Waits for [[H252]]'s parser.",
 'H262': 'Evict a task and its descendants on every device through the shared owner. Waits for [[H241]].',
 'H263': 'Make the slow-device browser isolation check deterministic without changing production behavior.',
 'H264': 'Replace Pause motion with a one-shot circuit trace in the guide and atlas.',
 'N139': 'Configure Work-mode light colors so unread tasks stand out from the base.',
 'N140': 'Add upgrade and rollback commands for the Linux runtime; the first real upgrade is separately authorized.',
 'P83': "Owner network step: block the Pixoo from Divoom's cloud while keeping local control, and record receipts.",
 'H11': 'Deferred Home Assistant and MQTT evaluation.',
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
 'H218': 'Clear Codex Desktop tasks and Line assignments when a session ends, in one owner update. '
         'Installed with the owner: the archive trial passed, but a non-archive end did not retire '
         'its session and the cause is under investigation; reopen-to-read is unverified. [[H241]] '
         'extends the rule to Codex CLI and Claude Code.',
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
 'H232': 'Document how to connect installed device controllers to B.U.N.N.Y. in the hub setup guide; '
         'the installed hub had no controllers configured, and the coordinator worked out the '
         'steps from source.',
 'H233': 'Add the Sonos Move, qualified in [[H158]], as a second playback source. One selected '
         'source drives the snapshot and commands; an unavailable source is shown, never swapped '
         'silently.',
 'H24': 'Implement the connection in [[H23]], then verify the physical transition. The Tidbyt '
        'cloud baseline [[H21]] is accepted.',
 'H240': 'Read-only design: propose enforceable merge gates for one maintainer sharing a GitHub '
         'identity with agents, and compare keeping the guide-only CI exception with a small '
         'hosted guide check. A proposal is not enabled protection.',
 'H241': 'Apply the retirement rule [[H218]] delivered for Codex Desktop to Codex CLI and '
         'Claude Code. Turn endings, waiting and freshness uncertainty never count as a '
         'session end; the 24-hour expiry remains the fallback.',
 'H242': 'Deferred. Qualify hub-issued resume of a paused iPhone AirPlay session on the Sony '
         'receiver, then add play/resume only if it works. The installed [[H175]] check confirmed '
         'pause; resume was manual from the phone.',
 'H244': 'Source inspection found that retiring a B.U.N.N.Y. browser session leaves its per-session '
         'ledger behind, so the 16-session cap does not bound those entries. Give session '
         'resources one retirement path. Memory growth has not been measured.',
 'H245': 'Give B.U.N.N.Y. forms and one-click actions one command lifecycle, so receipt, uncertainty '
         'and refresh fixes apply to both. Preserve the behavior delivered in [[H231]]. Preferred '
         'after [[H244]].',
 'H246': 'Map where Pixoo and Nanoleaf contract facts repeat across hub validators, MCP schemas '
         'and the dashboard, then consolidate them locally without a new package. Preferred after '
         '[[H245]]; the repository migrations [[H25]] and [[H26]] do not block it.',
 'H247': 'Give built-in dashboard pages and registered components distinct navigation identities, '
         'so a component alias of activity or connections opens only that component. The [[H6]] '
         'review deferred this navigation defect; it allows no permission bypass or automatic '
         'device write.',
 'H25': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H26': 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, '
        'and rollback decisions.',
 'H36': 'Optional Windows Apple Music source. Revisit once the Sony path from [[H175]] proves '
        'useful; it is not a prerequisite for the other music stories.',
 'H37': 'Text-only now-playing and the Sony-qualified controls (pause, next, previous) in B.U.N.N.Y. '
        'and Codex tools, using shared playback from [[H175]]. B.U.N.N.Y. sessions need a small hub '
        'change to read the playback source. Sony play/resume is qualified separately in [[H242]].',
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
 'N100': 'Show Claude Code titles and projects for shared tasks, as [[N75]] does for Codex. The '
         'hub feed deliberately carries neither, so the wall reads them locally by session ID. '
         'Waits for [[N111]] and three owner decisions.',
 'N110': 'Nanoleaf only and off by default: enter Work while the shared owner has any monitored '
         'session, and Free when the last one ends or expires. A manual mode choice pauses '
         'automation until it is re-enabled. Waits for [[H241]].',
 'N111': 'One session from an undeclared source makes Nanoleaf reject the whole hub snapshot, '
         'which freezes the wall. Skip such sessions instead and report them in shared status. '
         'Blocks [[N100]].',
 'N112': 'After an uncertain write or an expired command, the worker holds the Lines without '
         'saying so. Show the hold, its cause and a Resume action on the wall map and in CLI '
         'status; nothing retries automatically.',
 'N113': 'Make the NL22 Panels a second controller device, so the hub, dashboard and Codex control '
         'them like the Lines, each with its own single writer. This changes the ADR 0010 '
         'ownership rule. Scenes ([[N91]]) and animations ([[N92]]) can extend to the Panels '
         'afterward.',
 'N114': 'Change a registered device’s address, for example after a new DHCP lease, without '
         're-enrolling. The device keeps its identity, reservations, mode, layout and saved scene; '
         'the new address is verified first.',
 'N115': 'Two hub commits between polls count as a resync today, so a new completion loses its '
         'comet and wave. Treat a gap without loss evidence as an ordinary update. Coordinate with '
         '[[N81]].',
 'N117': 'An unchanged poll moves keyboard focus off Open in Codex. The fix is in review in the '
         'same Nanoleaf PR as the [[H218]] companion change.',
 'N118': 'Split bridge.py: shared configuration operations first, then hook management and runtime '
         'primitives; stop passing the bridge module as a value. The agreed Nanoleaf architecture '
         'order starts here; [[N120]] and [[N121]] build on it.',
 'N119': 'Move the wall page’s scattered rebuild decisions into one scheduler behind a view model, '
         'with one test hook for the browser checks. Behavior stays identical; [[N123]] decides '
         'the renderer set first. UI PR, so human approval applies.',
 'N120': 'Keep backup encoding, demo seeding and selected multi-table operations with the modules '
         'that own that state. The issue body records [[N118]] as its prerequisite.',
 'N121': 'Carry one device context through the worker instead of threading device parameters. '
         'Starts after [[N118]] and after the worker fixes [[N111]], [[N112]] and [[N115]] merge.',
 'N122': 'Investigation only: can the shared-input projection become a pure function tested '
         'without SQLite? Findings go on the issue.',
 'N123': 'Decision only: keep the standard SVG wall as a fallback for Prism, or retire it. Decide '
         'before [[N119]] fixes its renderer interface.',
 'N124': 'Owner task on the Windows PC: record Edge rendering cost for the wall map’s pulse, '
         'assembly and Prism renderer, and state a paint budget.',
 'N127': 'Build one explicit render input per worker pass, keeping credentials, paths and '
         'transport with their runtime owners. Output and APIs stay unchanged.',
 'N128': 'Investigation only: can wall-state construction become a pure read, with metadata '
         'refresh and drawing-cache work given explicit owners? Lower priority, after the first '
         'configuration work.',
 'N129': 'Investigation only: can one owner hold the worker’s transaction boundaries and '
         'transmission journaling without changing lock windows?',
 'N130': 'Measure SQLite lock contention between device workers, hook admission and controller '
         'reads with fake transport before proposing shorter transactions.',
 'N131': 'Delete the Windows installer, tray, WSL forwarding and MCP helper from source, supersede '
         'the Windows clauses of ADRs 0005 to 0007 and update the three affected specifications. '
         'Shares bridge.py with [[N118]].',
 'N132': 'Owner task on the PC: archive or delete the retired Windows installation and its token '
         'copy, prune stale worktree registrations and Codex trust entries. Independent of '
         '[[N131]].',
 'N135': 'Show one context card for the selected Line or task with only the controls that act now. '
         'The owner settled the design on September 24: layout moves to the Options menu, and '
         'reservation, half-swap and override controls appear only in Project layout. Found while '
         'reviewing [[N78]].',
 'N16': 'Deferred ambient direction. Its recorded Lively prerequisite closed as not planned '
        '([[N134]]); the view builds on the live renderer [[N17]], palettes and effects, and needs '
        'the owner to choose it.',
 'N17': 'The rendering contract [[N15]] is delivered. Build the live app renderer on it; with the '
        'Lively track closed, it and [[N16]] own the persistent-display direction.',
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
 'P67': 'Add user-entered playlist names to the Pixoo integration extension, so B.U.N.N.Y. and the hub '
        'MCP media tools ([[H152]]) can label playlists. They show playlist IDs until then.',
 'P76': 'Keep Divoom cloud content off the Pixoo after screen-on and device reboots, and document '
        'owner actions that cut the device off from Divoom’s cloud. Found during [[H154]].',
 'P77': 'Run the installed Pixoo app as a user service with the settings the hub needs, so B.U.N.N.Y. '
        'controls and agent status return after PC or WSL restarts. Found during [[H154]].',
 'P79': 'Dashboard uploads record display evidence that the MCP status schema rejects, so status '
        'can fail after an upload. Map it to the public upload value. This is a source finding, '
        'not yet reproduced.',
 'P80': 'Give command producers and observers typed operation metadata, separate from replay '
        'payloads. Preferred after [[P79]].',
 'P81': 'Share one SSE client-delivery implementation between the browser and native controller '
        'feeds, keeping each feed’s contract. Preferred after [[P80]].',
 'P82': 'Low-priority documentation cleanup: make the product and hub-integration guides describe '
        'the delivered local app and its Monitor/Media extension.'}
