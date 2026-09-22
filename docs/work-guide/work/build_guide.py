from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import html
import json
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import architecture_diagrams as AD  # noqa: E402  diagram definitions and rendered-file layout
import timeline as TL  # noqa: E402  history chart and ordered roadmap map

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs' / 'agent-device-work-guides.html'
VIEWERS = OUT.parent / 'architecture'
REPOS = {'H': ('agent-device-hub', 'Hub'), 'N': ('codex-nanoleaf', 'Nanoleaf'), 'P': ('divoom-app-upgrade', 'Pixoo')}
SNAPSHOT = json.loads((ROOT / 'work/backlogs/snapshot.json').read_text())
REFRESHED = datetime.fromisoformat(SNAPSHOT['refreshedAt']).astimezone(ZoneInfo('America/New_York'))
HISTORY = json.loads((ROOT / 'work/history/github-history.json').read_text())
DIAGRAM_RECEIPTS = json.loads((AD.ARCH / 'diagram-receipts.json').read_text())
ARCHIFY_CLASSES = json.loads((AD.RENDERED / 'archify-classes.json').read_text())
SOURCE_REVIEW = datetime.fromisoformat(AD.SOURCES['reviewedAt']).astimezone(ZoneInfo('America/New_York'))
ISSUES = {}
for key, (repo, _) in REPOS.items():
    for issue in json.loads((ROOT / 'work' / 'backlogs' / f'{repo}-issues.json').read_text()):
        ISSUES[f'{key}{issue["number"]}'] = issue

GUIDES = [
    dict(id='local-acceptance', short='Local acceptance', title='Completed local Codex control and physical acceptance', phase='Local release',
         intro='Pixoo and Nanoleaf local Codex acceptance are complete. The Pixoo reliability observations are accepted for the current uniform-500-ms profile; variable timing has its own follow-up.',
         headers=['Work', 'Issues', 'Remaining work'], rows=[
             ['Completed / Local Codex → Nanoleaf', '[[N34]]', 'Completed through Nanoleaf PR #50. The closing receipt records installation, actual Windows/WSL routes, physical observations and restoration under its scoped hosted-CI exception.'],
             ['Completed / Local Codex → Pixoo', '[[P26]]', 'Completed baseline, excluded from remaining-work counts. Reviewed delivery through Pixoo PR #50 records installed WSL-client checks, physical controls, restoration and credential revocation.'],
             ['Completed / Pixoo reliability', '[[P12]]', 'Pixoo PR #54 delivered the compatibility fix and accepted local evidence. All five merged-main jobs passed before closure. Variable timing remains unverified in [[P55]]; the current uniform-500-ms profile is unchanged.'],
         ], notes=[
             'The <a href="https://github.com/jimmie-potts/codex-nanoleaf/issues/34#issuecomment-5580156676" target="_blank" rel="noopener noreferrer">September 8 Nanoleaf closing receipt</a> records completed local acceptance and restoration. Its hosted-CI exception applies only to that delivery; shared monitoring remains separate.',
             'The <a href="https://github.com/jimmie-potts/divoom-app-upgrade/issues/26#issuecomment-5578479319" target="_blank" rel="noopener noreferrer">Pixoo closing evidence</a> records restored and visually confirmed brightness and screen power. Unknown prior artwork was not restored. Its local PR/main validation exception does not apply automatically to other work.',
             '[[P12]] covers local physical reliability separately from local MCP acceptance. Remote browser and phone acceptance remain separate work.',
             'The September 8 soak completed 60 minutes and 119 ordered transitions with no backend error or recovery event. The owner confirmed continued alternation through the end with only the accepted flashing defect [[P52]]. Screen-on can return native GIFs while playback stays paused; the owner accepted this limitation and verified explicit Resume restores the selected item.',
             'The variable-timing experiment did not establish different visible frame durations. The owner approved moving only this qualification to [[P55]], preserving the uniform-500-ms profile and the ambiguous observations. The approximate 28-second still reading remains outside the agreed 29-31-second range; two later readings were 30.3 seconds. Backend timings do not establish precise visible cadence. All physical helpers are closed; final blue 30 was owner-confirmed.'
         ]),
    dict(id='shared-codex', short='Shared Codex integration', title='Deliver shared Codex monitoring and integration controls', phase='Main development path',
         intro='[[H32]] is the existing guide for this milestone. This is the main cross-project development sequence.',
         headers=['Stage', 'Owning issues', 'Result'], rows=[
             ['01 / Qualification and budgets', '[[H2]] [[H30]]', 'Hub #2 delivered lifecycle contract v1, portable validators and shared fixtures in PR #74, with passing merged-main CI and a checksum-pinned release. Hub PR #77 merged the early Linux source baseline and numeric budgets on September 12 UTC: 9,000 hook calls across repeated 1/10/50-session profiles and verified worker cleanup. These artifacts now inform dependent runtime designs. The owner excluded further #77 CI verification from this reconciliation; source merge does not assert successful merged-main CI. Standalone Linux/WSL feed/consumer qualification remains pending under the owner-approved personal-project scope. Historical latency ceilings are diagnostic comparisons for this stage; the hard deadline and resource limits remain required. Native Windows comparison and executable forwarding are no longer required; CI platform cleanup is separate. Documented provider support does not prove installed-client compatibility.'],
             ['02 / Shared state and contracts', 'Completed [[H3]] [[P29]]', 'Pixoo #29 delivered its released lifecycle-contract adoption in PR #53. Hub #3 is closed after PR #105 merged the shared state source and the <a href="https://github.com/jimmie-potts/agent-device-hub/releases/tag/agent-state-v1.0.0" target="_blank" rel="noopener noreferrer">agent-state 1.0.0 release</a> published the reproducible archive, checksum and source receipt. All five applicable merged-main jobs passed after the separately owned CI repair in PR #108, with agent-state source and package inputs unchanged. The package provides deterministic reduction, host storage persistence, retained notices, a bounded diagnostic journal, independent consumers and source emitters. Pixoo #31 owns production hosting and durable storage adoption; Hub #8 supplies source setup; installed-provider qualification remains separately authorized.'],
             ['03 / First host and controller API', 'Completed [[P31]] [[P37]]', 'Pixoo PR #58 delivered the optional protected controller v1 API through its existing ledger, player and serialized writer. Issue #37 is closed after all five PR and all five merged-main jobs passed, with 515 application tests and 52 browser tests passing locally. Configured identity, scoped authentication, replay, bounded feeds and cross-client media evidence are implemented. Pixoo #31 is closed after PR #60 delivered one private durable state owner, authenticated bounded admission and feeds, a selected embedded/remote source and explicit quiesce/export/import. All five PR and five merged-main jobs passed; local checks passed 553 application tests and 54 browser tests. Monitoring never commands the device. The owner moved embedded-host performance measurement and numeric acceptance to [[P61]], which depends on #31 and does not block its feature merge. Failed measurements and frozen limits remain recorded. Installation, real hub-client operation and physical acceptance remain separate.'],
             ['Completed / Nanoleaf shared consumer', '[[N29]]', 'Nanoleaf #29 is closed after PR #62 and all nine PR plus all nine merged-main jobs passed. Explicit shared selection makes the feed authoritative while the existing Python worker remains the sole light writer. Disconnected or uncertain sessions retain steady last colors, with no automatic legacy fallback. An evidenced new turn clears notices for Nanoleaf only. Hub #8 supplies source cutover tooling; installed cutover and Nanoleaf #30 physical acceptance remain separate. '],
             ['Completed / Nanoleaf integration settings', '[[N49]]', 'Nanoleaf #49 is closed after PR #63 and all nine PR plus all nine merged-main jobs passed. The Nanoleaf-owned versioned extension exposes sanitized settings and assignments, with protected revisioned edits through existing wall operations and the sole worker. Shared controller v1 stays unchanged. Configuration receipts do not prove physical outcomes. Native Linux and retained Windows keep separate private state. Frontend integration, installation and physical acceptance remain separate.'],
             ['Completed / Pixoo monitor controls', '[[P32]] [[P33]]', 'Pixoo dashboard #32 is delivered through PR #63. Issue #33 is closed after PR #64 and all five PR plus all five merged-main jobs passed. The Monitor panel provides owner-backed labels/notices, selected project/session views and exact RGB preview. Explicit Monitor activation pauses media and uses the existing generation-guarded writer; Media keeps collecting without monitor pictures. Restart and screen-on remain passive. A protected versioned extension preserves shared controller v1 and existing MCP media tools. Installed-client and physical acceptance remain [[P34]]. PR #65 merged its source packaging: a pinned shared setup SDK, disposable Pixoo rehearsal and operator acceptance sequence. The owner reduced #34 to one Codex Desktop task path through Ubuntu WSL: working/completed activity, notice clearing/dismissal, a short readable Pixoo display check and basic Monitor/Media behavior. Installation and actual observations remain pending. Required CLI/Claude trials, migration, broad failure matrices and a shared-frontend trial are outside this revised scope.'],
             ['Completed / Pixoo display qualification', '[[P30]]', 'Pixoo PR #59 delivered the offline-default bounded runner, exact RGB previews and shared writer exclusion. Four authorized recorded runs now support complete RGB frames with a configurable 1000 ms minimum submission interval. Both row clearing and separately authorized restart were observed; cancellation left an in-flight picture applied, with no automatic retry. The owner confirmed readability. Text/items remain excluded because exact device fonts and layout are unqualified. The small sparse sample and uncalibrated cross-clock timing do not establish sustained 1 Hz or universal firmware limits. PR #62 merged acceptance and ADR 0015, all five PR and all five merged-main jobs passed, and #30 is closed. #33 consumes the decision, while #32 renderer source is delivered and #34 real-client physical acceptance remains separate.'],
             ['Parallel / Embedded-host performance', '[[P61]] after [[P31]]', 'Audit measurement boundaries, diagnose and optimize bottlenecks, then qualify frozen limits. Preserve failed receipts and its existing acceptance criteria. This embedded-host hardening is independent of feature delivery and is not required to implement or close standalone-only [[H30]].'],
             ['05 / Shared hosting and clients', '[[H5]] [[H8]] [[H6]] [[H13]]', 'Hub #5 now targets Linux in WSL; native Windows runtime qualification is outside its accepted scope. PR #121 merged its authenticated APIs, delivered [[P33]] and Nanoleaf settings adapters, supervised migration and rollback after writes. Both independent reviews, all five PR checks and all five merged-main checks passed; [[H5]] is closed for source delivery. The owner approved 256 MiB service RSS; [[H123]] tracks later budget and memory improvements. [[H8]] is closed for Linux/WSL source delivery through PR #129 at f6bee907. Both independent reviews, all five PR checks and all five merged-main checks passed. Reversible hooks, credential revocation and explicit Nanoleaf cutover are source-tested with real disposable consumers. Personal installation, actual-client qualification and physical acceptance remain separate. The common frontend is source-delivered through PR #127; installed browser and MCP clients retain their own acceptance gates.'],
             ['Completed / Shared MCP host', '[[H13]]', 'The opt-in loopback host route composes the reusable MCP module with qualified session inspection, shared label/acknowledgment commands and configured-controller tools. Aliases bind native owners; receipts keep their original identities. Synthetic protocol and offline-package checks cover authorization, replay, controller failure and disconnect. PR #126 merged as ee1eac1 after independent Standards and Specification approval and all five PR checks. All five merged-main checks passed before source issue #13 closed. The full hub suite passed 43 tests, including 14 MCP tests; the offline installed archive passed 42 tests. Installed Codex/Claude, physical acceptance and public publication are separate. Pixoo catalog/player handlers remain in its application.'],
             ['Service memory budget and hardening', '[[H123]]', 'The owner raised the Linux/WSL service RSS budget from 128 to 256 MiB. Re-evaluate budgets and reduce measured memory use in this backlog follow-up; it does not block Hub #5. Original failed measurements remain retained; the budget revision is not an optimization or complete integrated qualification.'],
             ['Completed / Personal Nanoleaf installation', '[[N30]]', 'The owner narrowed #30 to a one-off Linux/WSL update and real Codex Desktop/CLI-to-light checks. Both real tasks reached the shared owner and Nanoleaf without duplicate identities. Shared input survived service restart, and the owner observed task-related light color changes. Quiet, Free and Work returned confirmed transmission, ending in Work; the existing wall map rendered without page errors. The issue is closed. Pixoo is also registered with new-turn notice clearing and a private read/control credential; its own installed acceptance remains separate. No reusable updater, formal rollback, Windows/Claude or broader performance qualification is claimed.'],
             ['06 / Everyday standalone qualification', '[[H30]] [[H9]] [[P34]]', 'Qualify the standalone Linux/WSL hub with real Pixoo/Nanoleaf consumers, synthetic input and fake device transports. Measure hook return and consumer receipt for one task and a realistic concurrent profile, with a short 50-task overload check. Cover dashboard connection/reconnect, an ordinary integration control, one unavailable consumer and host restart. Reuse existing migration and presentation regressions; omit embedded-host and production rollback qualification. One command produces a concise revision-pinned report. Define practical targets before runs; retain the 3,000 ms hard hook deadline, 256 MiB service RSS ceiling, bounded resources, isolation and cleanup. Historical percentile ceilings remain diagnostic for #30. Installed-client and physical acceptance stay in their owning issues; they are not #30 closure gates.'],
         ], notes=[
             'The shared state implementation belongs in the hub from the start, even while Pixoo hosts it. Each device keeps its own rendering, private state, and writer.',
             '[[H6]] is closed after PR #127 merged as 5724f51. The delivered frontend uses the approved Nanoleaf Prism/Neon visual language for central BUNNY activity, component and connection views. The user approved the source UI candidate; both independent reviews and all six PR plus all six merged-main checks passed. Installation, actual-client and physical acceptance remain separate. Current and future user-facing components join consistent navigation and reusable status, settings and supported-control views. A third synthetic component verifies differing capabilities; new production integrations retain their own API, UI and acceptance work.',
             'Routine supported integration operations stay in the central UI. Advanced wall and playlist editors remain linked initially. [[H31]] later extends the same application with general controls; full editor migration and exact previews retain separate scope.',
             '[[H30]] deliberately spans two stages. Its delivered <strong>early budget artifact</strong> remains historical evidence; its <strong>remaining qualification</strong> now covers everyday standalone operation. [[P61]] is not a completion dependency. New standalone targets must be documented before runs; this planning revision neither changes historical receipts nor claims a passing qualification. Waiting for the whole issue to close before starting the runtime would create a planning deadlock.',
             'Codex is the first milestone. Any remaining Claude acceptance criteria stay tracked in their owning issues.'
         ]),
    dict(id='nanoleaf-devices', short='Lines + Light Panels', title='Add Nanoleaf Light Panels alongside Lines', phase='Independent feature',
         intro='This Nanoleaf sequence can use existing automatic task ingestion without waiting for shared monitoring.',
         headers=['Order', 'Issue', 'Result'], rows=[
             ['01 / State and geometry', '[[N41]]', 'Device-aware state, identities, geometry, and migration contracts.'],
             ['02 / Windows worker', '[[N42]]', 'Independent device assignments, scheduling, modes, and recovery through the Windows worker.'],
             ['03 / Panel effects', '[[N43]]', 'NL22 triangle geometry and task effects.'],
             ['04 / Map and tray', '[[N44]]', 'Lines and Panels together in the wall map and tray.'],
             ['05 / Upgrade tooling', '[[N45]]', 'Enrollment, reversible upgrades, and rollback tooling.'],
             ['06 / Installed acceptance', '[[N46]]', 'Verify the installed bridge with both physical systems.'],
             ['Later / Combined pool', '[[N47]]', 'Explore a combined layout and allocation pool after the independent-device release is verified.'],
         ], notes=['The first release mirrors eligible tasks into independent device allocation pools. The combined-pool design retains its own later decisions and acceptance.']),
    dict(id='tidbyt-lifx', short='Tidbyt + LIFX', title='Add automatic status to Tidbyt and LIFX', phase='Additional devices',
         intro='Both controllers belong in the hub repository and consume the same shared state.',
         headers=['Track', 'Issue sequence', 'Work and dependencies'], rows=[
             ['Tidbyt cloud', '[[H15]] → [[H16]] → [[H19]] → [[H21]]', 'Qualify the connection, implement the controller, add automatic status, then complete installed acceptance.'],
             ['LIFX LAN', '[[H17]] → [[H18]] → [[H20]] → [[H22]]', 'Qualify direct LAN control, implement the controller, add automatic status, then complete installed acceptance.'],
             ['Later / Tronbyt', '[[H23]] → [[H24]]', 'Implement the connection, then verify the physical transition. The transition also requires the Tidbyt cloud acceptance baseline.'],
             ['Other integration options', '[[H11]]', 'Deferred Home Assistant and MQTT evaluation.'],
         ], notes=[
             'Connection qualification can start independently. Automatic status needs [[H3]] and [[P31]]; installed lifecycle acceptance also needs [[H8]]. LIFX model identification remains part of qualification.',
             'These devices extend the system without becoming prerequisites for the first Pixoo/Nanoleaf Codex milestone.'
         ]),
    dict(id='pc-lighting', short='PC + desk lighting', title='Add PC and desk lighting, starting with Corsair', phase='Future qualification and delivery',
         intro='[[H50]] owns the documentation and backlog. Corsair is the first adapter. Optional Strimer and Varmilo additions must not block Corsair; keyboard support must not block Strimer.',
         headers=['Track', 'Owning issues', 'Required work and prerequisites'], rows=[
             ['Documentation', '[[H50]]', 'Hub PR #59 merged the documentation on September 10. Hub #50 remains open in this snapshot; source merge does not establish installation or hardware acceptance. These integrations remain separate work.'],
             ['Corsair first', '[[H51]] → [[H53]] → [[H57]]', 'Qualification follows Hub #50. The controller requires Hub #51 and the completed contract baseline [[H4]]. Physical acceptance also requires shared automatic status [[H55]] and lifecycle setup [[H8]].'],
             ['Optional Strimer', '[[H52]] → [[H54]] → [[H58]]', 'Hub #54 is closed in the refreshed tracker and retained as a reference; this refresh does not establish adapter or physical acceptance. Qualification and acceptance retain their owning issues and prerequisites.'],
             ['Shared automatic status', '[[H55]]', 'Requires the Corsair controller [[H53]], shared state [[H3]] and its first host [[P31]]. Strimer participation requires Hub #54; Varmilo requires Hub #61 and a supported interface. Neither optional adapter gates Corsair status.'],
             ['Shared UI and MCP controls', '[[H56]]', 'Requires Hub #53, the completed MCP baseline [[H7]] and general-control definition [[H31]]. Refine frontend prerequisites after that definition. Monitoring policy and optional adapters apply only when selected. This does not block automatic status or Corsair acceptance.'],
             ['Optional Varmilo keyboard', '[[H60]] → [[H61]] → [[H62]]', 'Qualification follows Hub #50. The adapter also requires Hub #53 and the contract baseline. Acceptance also requires Hub #55 and Hub #8. Start with whole-keyboard shared agent-status lighting through an existing supported interface.'],
         ], notes=[
             'Recorded Corsair targets are Dominator Platinum RGB DDR5 memory and supported H150i ELITE LCD XT lighting through iCUE. SDK compatibility, connected hardware and LED groups still need qualification.',
             'Strimer records show a Strimer Plus Controller with 24-pin and dual 8-pin configurations. Exact cable generation, connected hardware and independent channel capabilities remain unverified.',
             'Varmilo VA108M-RGB automation compatibility is unverified. If no supported interface qualifies, integration stays deferred even if the research issue closes. Preserve normal typing, mappings, macros, lock indicators and stock firmware. Per-key lighting, custom protocol work and simulated-keypress fallbacks are outside the selected first release.',
             'Preserve iCUE, L-Connect 3, vendor configuration and cooling controls. Fan speeds, pump settings, cooler LCD content and wider motherboard/GPU lighting remain outside this feature. Keep one shared state owner and one designated writer per device.',
             '<a href="https://github.com/jimmie-potts/agent-device-hub/pull/59" target="_blank" rel="noopener noreferrer">PC-lighting documentation PR #59</a> remains a separate delivery. All eleven follow-up issues are deferred backlog work requiring refinement; this guide performs no qualification, installation or device operations.',
         ]),
    dict(id='desktop-controls', short='Desktop controls', title='Add Wispr, Codex mouse actions and later desk presets', phase='Independent shortcuts, then shared presets',
         intro='[[H63]] and [[H64]] are ready for future selection. Investigation remains deferred. The other seven issues are blocked by their prerequisites. <strong>Wispr and basic Codex mouse controls can ship without the hub, shared monitoring, general controls or Music.</strong> Wispr retains its own service requirements.',
         headers=['Work', 'Owning issue', 'Required prerequisites and result'], rows=[
             ['Documentation', '[[H63]]', 'None. Record defaults, control profiles, desk presets and delivery boundaries. Coordinate with PC-lighting documentation without making PR #59 a prerequisite.'],
             ['Hardware and Wispr qualification', '[[H64]]', 'None. In a future session, qualify exposed remappable controls, hold/release behavior, app focus and supported interfaces. The mouse model/edition remains unverified; Retro R8 is a candidate.'],
             ['Independent / Local controls', '[[H65]]', 'Requires [[H63]] and [[H64]]. Big A: hold to dictate, release to insert through Wispr Flow. The integration adds no automatic send action. Codex mouse actions: next task needing attention, command menu, previous task and next task. Preserve ordinary mouse behavior outside Codex.'],
             ['Independent / Local acceptance', '[[H66]]', 'Requires [[H65]]. Separately authorize installation, real input and app checks, release recovery and restoration. This delivery does not require shared device presets.'],
             ['Shared / Work, Free and Quiet', '[[H67]]', 'Requires [[H63]], Codex-first milestone [[H32]], general-control definition [[H31]], standalone host [[H5]], [[N49]] and [[P33]]. Define supported actions and participation through existing owners.'],
             ['Shared / Big B and feedback', '[[H68]]', 'Requires [[H65]] and [[H67]]. Each fresh press cycles Work → Free → Quiet → Work through the hub, with visible requested and partial/failed/uncertain results. Manual dispatch does not require automation engine [[H45]].'],
             ['Shared / Handoff and restoration', '[[H69]]', 'Requires [[H68]] and lifecycle setup [[H8]]. Verify selected device results and manual handoff separately from transport. Additional devices require their own qualification and acceptance.'],
             ['Later / Custom mappings and profiles', '[[H70]]', 'Requires [[H65]]. Cover every hardware-exposed remappable control, saved profiles, supported app/hub actions and custom shortcuts. Local profile editing stays useful without optional preset or Music providers.'],
             ['Later / Music preset', '[[H71]]', 'Requires [[H68]], playback [[H36]] and policy owner [[H40]]. Add presentation prerequisites [[H38]] and/or [[H39]] only for selected branches. [[H41]] is conditional on measured-audio effects.'],
         ], notes=[
             '<strong>A control profile</strong> maps controls, gestures and app scope to actions. <strong>A button binding</strong> is one assignment. <strong>A desk preset</strong> applies configured actions to participating lights and displays. Selecting a control profile alone sends zero device commands.',
             'Work requests configured agent-status presentation. Free releases it to supported normal scenes or media. Quiet retains subdued status with reduced brightness and minimal animation where supported. Preserve native Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media semantics; a desk preset introduces no shared device-mode enum.',
             'Manual changes in device apps remain until the next explicit preset request, which follows supported ownership handoff. Offline targets cannot stall other queues. Reconnects, app startup and profile selection must not replay old presses or issue device commands.',
             'The first mapping editor excludes arbitrary scripts, shell execution, raw device commands and multi-step macros. Preserve ordinary typing, vendor mappings and the existing CHOMPI bridge. Hardware support and installed behavior remain future acceptance work.',
             'The existing publication receipt verified all 17 native prerequisite links in both directions and found no cycles in their 35-issue closure. This refresh reads those planning records and current issues; earlier work already published the tickets and consumer links in [[H31]], [[H35]] and [[H40]].',
         ]),
    dict(id='nanoleaf-presentation', short='Rendering + displays', title='Improve Nanoleaf rendering, customization, and persistent displays', phase='Independent experience',
         intro='There are two main paths here, plus smaller independent improvements.',
         headers=['Group', 'Issues and order', 'Dependency or boundary'], rows=[
             ['Authoritative live rendering', '[[N15]] → [[N17]]', 'Deliver the rendering contract, then the live app renderer.'],
             ['Consistent colors', '[[N18]]', 'Add project/status palettes after rendering and Hub #2’s vocabulary.'],
             ['Effect customization', '[[N19]] [[N20]]', 'Add completion celebrations and status animations after rendering and palettes.'],
             ['Lively prototype', '[[N10]] → ([[N11]] + [[N12]]) → [[N13]] → [[N14]]', 'Qualify compatibility; add persistent addressing and inspection mode; integrate startup/recovery; then evaluate the installed prototype.'],
             ['Optional ambient presentation', '[[N16]]', 'Follow the prototype evaluation, rendering/customization work, and a decision to proceed.'],
             ['External scenes', '[[N21]]', 'Investigate external scene mirroring independently of bridge-controlled rendering.'],
             ['Prism crystal artwork', 'Completed [[N52]] → [[N53]] → [[N26]]', 'Connector geometry, crystal artwork with two-second inward flow, and luminous numbering are delivered through Nanoleaf PRs #56, #58 and #60. Each passed all nine main jobs, and the user approved the integrated UI. The browser suite passed 360 click cases and 720 label-clearance measurements. Hub companion PR #82 merged and passed all thirteen main jobs. All three stories are closed as completed. Installation, tray artwork, physical-light animation changes and public guide publication are separate.'],
         ], notes=['Live rendering does not need Lively acceptance. The first shared hub frontend and basic Light Panels support also remain independent of exact animation mirroring.']),
    dict(id='pixoo-media', short='Pixoo media', title='Extend Pixoo’s media and playlist experience', phase='After reliability',
         intro='These deferred features follow the physical reliability baseline in [[P12]].',
         headers=['Feature', 'Issue', 'Work'], rows=[
             ['Scheduling', '[[P13]]', 'Timezone-aware playlist schedules.'],
             ['Portability and convenience', '[[P15]]', 'Playlist portability and UI convenience planning.'],
             ['Transitions', '[[P16]]', 'Qualification of supported transition improvements.'],
             ['GIF handoff defect', '[[P52]]', 'Investigate reproduced rapid extra flashes before a still. Explicitly nonblocking for Pixoo #12; physical work needs separate authorization.'],
             ['Variable GIF timing', '[[P55]]', 'Qualify asymmetric visible frame durations with a bounded measurement and control. Owner-approved deferral from Pixoo #12; preserve the current profile until evidence supports a change. Physical tests need separate authorization.'],
             ['Cloud-gallery import', '[[P18]]', 'Authorized cloud-gallery import assessment.'],
         ], notes=['Select these individually after reliability acceptance. Transition and gallery issues need feasibility findings before committing to feature implementation.']),
    dict(id='controls-music', short='Controls + music', title='Expand into general device controls and Apple Music', phase='After Codex acceptance',
         intro='[[H35]] already provides the future-work guide. Its accepted order starts with Codex integration, then general controls, then music.',
         headers=['Stage', 'Issues', 'Work'], rows=[
             ['General controls', '[[H31]]', 'After Hub #32 acceptance, choose capabilities and refine implementation work within the central BUNNY UI established by [[H6]]. Future components reuse its navigation and status/settings/control views; each feature records its capabilities, permissions, owning API and UI acceptance.'],
             ['Windows playback', '[[H36]]', 'Qualify and build the Apple Music connector.'],
             ['Participation and interruption', '[[H40]]', 'Define per-device music and alert policy. Settle this alongside connector qualification, before effects take over devices. This is a recommended sequence.'],
             ['Common music controls', '[[H37]]', 'Add music controls to the shared UI and Codex tools.'],
             ['Device presentations', '[[H38]] [[H39]]', 'Add Pixoo/Tidbyt now-playing cards, song-change lighting, and Nanoleaf scene qualification.'],
             ['Audio-reactive behavior', '[[H41]]', 'Investigate audio capture and visualizers.'],
         ], notes=['Now-playing metadata, song-change effects, and measured audio visualizers have different requirements. Each needs its own qualification and acceptance.']),
    dict(id='hosting-migrations', short='Hosting + migrations', title='Prepare always-on hosting and deliberate migrations', phase='Separate migration tracks',
         intro='Coordinate hosting across projects while keeping source relocation separate from runtime changes.',
         headers=['Group', 'Issues', 'Sequence or boundary'], rows=[
             ['PC/container hosting', '[[H42]] [[P14]]', 'Hub builds on standalone hosting; Pixoo’s Docker/ARM64 qualification follows Pixoo #12. Coordinate networking, storage, recovery, and packaging.'],
             ['Completed / Linux source', '[[N54]]', 'Nanoleaf PR #57 delivered the fresh Linux installer and separate services at 2558df5. Source checks use isolated state and fake devices. Hub PR #84 delivered the architecture companion.'],
             ['Nanoleaf Linux installation', '[[N55]] → [[H43]]', 'Perform separately authorized installed acceptance, then reconcile the observed outcome under Hub #43. Retire this project’s Windows owner before enabling Linux. Existing Nanoleaf state can remain unused; preserve unrelated data and one light writer. Service startup, real Codex hooks, browser access and physical Work/Quiet/Free behavior remain unverified.'],
             ['Dedicated server', '[[H44]]', 'Choose hardware and migration requirements after measuring workloads and portability.'],
             ['Source consolidation', '[[H25]] [[H26]]', 'Schedule Pixoo and Nanoleaf repository migrations separately, with ownership, provenance, and rollback decisions.'],
         ], notes=['Containerization and repository consolidation do not block the first useful local release. Moving Nanoleaf source into the hub does not establish Linux compatibility.']),
    dict(id='assistant-access', short='Assistant + access', title='Add automation, conversation, and later access methods', phase='Future refinement',
         intro='These tracks build on working local controls. The assistant placeholders need bounded acceptance criteria before implementation.',
         headers=['Track', 'Issues', 'Suggested progression'], rows=[
             ['Persistent automation', '[[H45]]', 'Define approved rules that run without an open conversation.'],
             ['Conversational assistant', '[[H46]]', 'Use shared controls and automation tools.'],
             ['Phone conversation', '[[H47]]', 'Add phone access and tap-to-talk after local delivery.'],
             ['Ambient/wearable voice', '[[H48]]', 'Explore after useful phone access.'],
             ['Closed planning reference / Personal services', '[[H49]]', 'The tracker closed this placeholder on September 21. Closure alone does not establish a qualified connector or connected account; any future implementation needs its own accepted scope and evidence.'],
             ['Pixoo remote browser', '[[P11]] → [[P43]]', 'Deliver HTTPS LAN access, then browser acceptance. Also requires Pixoo #12’s local physical baseline.'],
             ['Pixoo ChatGPT access', '[[P17]] → [[P44]]', 'Deliver the private MCP connection, then ChatGPT acceptance. Also requires Pixoo #26’s local acceptance baseline.'],
         ], notes=['Pixoo’s remote-access findings can inform hub phone access, but they do not automatically qualify access to the shared hub.']),
    dict(id='development-workflow', short='Development workflow', title='Reduce development overhead and consolidate shared tooling', phase='Maintenance',
         intro='Keep complete validation while reducing duplicate work and repeated setup.',
         headers=['Group', 'Issues', 'Order'], rows=[
             ['BUNNY system design documents', 'Completed [[H103]]', 'Hub #103 is closed after PR #104 merged the linked HTML overview, component designs, combined reading view, offline Scalar references for 37 explicit HTTP operations and SchemaSpy reports for 28 source-defined tables. Browser request controls remain disabled pending integration with each owning service. This documentation delivery does not implement or deploy the described system.'],
             ['Bound CI costs and hangs', 'Completed [[N37]] [[P46]]', 'Pixoo #46 and Nanoleaf #37 delivered main-only push checks, PR concurrency and bounded jobs with their original validation coverage. Both issues are closed; these changes do not establish product or device acceptance.'],
             ['Hub CI efficiency', 'Completed [[H91]]', 'Hub #91 is closed after PRs #92 and #93 delivered core scheduling, build-once test commands and pip caching, and PR #82 delivered matching guide scheduling. All thirteen main jobs passed at that revision, retaining every then-supported test and platform. Full core builds fell from 32 to 10. One main-run sample fell from 814 to 664 runner-seconds and 19 to 18 rounded minutes. Mixed PR samples do not establish monthly billing savings. Live superseded-run cancellation remains unobserved.'],
             ['Five Ubuntu checks', 'Completed [[H107]]', 'Hub #107 is closed after PR #108 delivered the owner-selected Ubuntu-only matrix and repaired package-index setup. All five PR and all five merged-main jobs passed. Controller, lifecycle and agent-state validation share Python 3.12 and 3.14 jobs; MCP, workflow/Linux-hook qualification and guide/browser validation each keep one job. Native Windows CI was removed while the existing Linux suites, package consumers and performance checks were retained. Core builds fell from ten to three per run. These results establish validation coverage, not measured billing savings. Windows client and device ownership are unchanged.'],
             ['Guide-only CI', 'Completed [[H100]]', 'Hub #100 is closed and PR #101 merged the guide-only path filters. Both automatic Hub workflows exclude changes entirely under docs/work-guide/, including generators and tests. Local guide checks and independent review remain required. Guide UI changes do not require human approval; all other UI changes do. Mixed changes retain normal CI; verify filter applicability for each delivery.'],
             ['Optional Pixoo job consolidation', '[[P47]]', 'Pixoo #46 is complete. Assess whether setup savings justify changing the job layout when #47 is separately selected.'],
             ['Shared OpenSpec tooling', '[[H10]] → ([[N31]] + [[P38]])', 'Publish the common package, then adopt it while preserving repository-specific checks.'],
             ['Guide connector visibility', '[[H73]]', 'Reserved UI evaluation case. Preserve the pinned defective input; this prerequisite delivery does not repair it or authorize evaluation runs.'],
             ['Public work guide', 'Completed [[H80]]', 'Public hosting acceptance is complete. The September 21 readback verified the previous edition’s landing page and all eight viewers without authentication, with every served hash matching its reviewed source. Future editions still require a separate reviewed publication PR, successful Pages deployment and a live hash check of every published HTML file.'],
             ['Guide workflow checkpoints', 'Completed [[H83]]', 'Hub PR #88, Pixoo PR #56 and Nanoleaf PR #59 adopted the shared checkpoints delivered in <a href="https://github.com/jimmie-potts/agent-skills/issues/33" target="_blank" rel="noopener noreferrer">agent-skills #33</a> through the existing Hub maintenance and publication procedure. Public guide PR #2 deployed the reviewed source; its landing page and all eight viewers passed unauthenticated served-hash checks. Hub #83 is closed as completed. The external prerequisite remains a reference outside these three-repository issue totals.'],
             ['Guide Prism design and rollout', '[[H85]] → [[H86]] → [[H87]]', 'Prepare and review a guide-specific design, apply artwork and subtle motion to the generated guide and viewers, then verify the existing local and public copies. The SDLC exempts guide UI from human approval; reconcile older approval wording during authorized issue updates. Design deliverables, validation and dependencies remain. This is separately planned work; the Nanoleaf source companion does not implement or publish it.'],
         ], notes=['Earlier runs recorded exhausted Actions allowance. Current Hub and Pixoo main reruns passed on September 8; every new candidate still needs its own required checks. Shared tooling consolidation remains deferred.']),
]

# Stable guide IDs own coverage; guide order has no effect on issue assignments.
coverage = json.loads((ROOT / 'work/backlogs/guide-coverage.json').read_text())
assert set(coverage) == {g['id'] for g in GUIDES}
assert all(issue['state'] in ('OPEN', 'CLOSED') for issue in ISSUES.values())
all_primary = [key for ids in coverage.values() for key in ids]
open_keys = {key for key, issue in ISSUES.items() if issue['state'] == 'OPEN'}
assert len(all_primary) == len(set(all_primary)), 'Duplicate primary coverage'
assert set(all_primary) == open_keys, f'Coverage mismatch: {set(all_primary) ^ open_keys}'
TOTAL = len(open_keys)
COUNTS = {key:sum(k.startswith(key) for k in open_keys) for key in REPOS}
assert TOTAL == SNAPSHOT['openIssues']
assert all(COUNTS[key] == SNAPSHOT['repositories'][repo]['openIssues'] for key,(repo,_) in REPOS.items())
assert ISSUES['P26']['state'] == 'CLOSED' and ISSUES['P26']['stateReason'] == 'completed', 'Review completed baseline prose'
TIMELINE = TL.build(HISTORY, SNAPSHOT['refreshedAt'], ISSUES, {g['id']: g['short'] for g in GUIDES}, coverage)
# Architecture is a reference section: its issue links never add to counts, and its
# source review has its own timestamp separate from the backlog snapshot.
receipt_by_id = {r['id']: r for r in DIAGRAM_RECEIPTS['diagrams']}
assert [d['id'] for d in AD.DIAGRAMS] == [r['id'] for r in DIAGRAM_RECEIPTS['diagrams']], 'Rendered diagrams do not match definitions'
for receipt in DIAGRAM_RECEIPTS['diagrams']:
    validation = receipt['validation']
    assert validation['checksPassed'] == validation['checkCount'] == 9 and validation['errors'] == 0 and validation['warnings'] == 0, receipt['id']
    assert AD.sha256(AD.RENDERED / f"{receipt['id']}.svg") == receipt['svgSha256'], f"Stale SVG for {receipt['id']}"
    assert AD.sha256(AD.RENDERED / receipt['viewer']) == receipt['artifact']['sha256'], f"Stale viewer for {receipt['id']}"
METADATA = dict(refreshedAt=SNAPSHOT['refreshedAt'], staticSnapshot=True, openIssues=TOTAL,
                guideCount=len(GUIDES), projectCount=len(REPOS), repositoryCounts=COUNTS,
                primaryCoverage=coverage, completedBaselines=['H5', 'N29', 'P12', 'P26', 'P29', 'P37', 'H2', 'H4', 'H7'],
                history=TIMELINE['meta'],
                architecture=dict(reviewedAt=AD.SOURCES['reviewedAt'], renderedAt=DIAGRAM_RECEIPTS['renderedAt'], sourceRevisions=AD.SOURCES['sourceRevisions'],
                                  diagramCount=len(AD.DIAGRAMS), diagrams=[dict(id=d['id'], kind=d['kind'], status=d['status'], viewer=f"architecture/{d['id']}.html",
                                                                                 viewerSha256=receipt_by_id[d['id']]['artifact']['sha256']) for d in AD.DIAGRAMS],
                                  countedInIssueTotals=False))

def link(match):
    key = match.group(1)
    issue = ISSUES[key]
    label = f'{REPOS[key[0]][1]} #{issue["number"]}'
    return f'<a class="issue repo-{key[0]}" data-issue="{key}" data-state="{issue["state"]}" href="{html.escape(issue["url"], quote=True)}" target="_blank" rel="noopener noreferrer" title="{html.escape(issue["title"], quote=True)}"><span>{label}</span><span aria-hidden="true" class="external">↗</span><span class="sr-only">: {html.escape(issue["title"])} ({issue["state"].lower()}; opens in GitHub)</span></a>'

def render(text):
    return re.sub(r'\[\[([HNP]\d+)\]\]', link, text)

nav = []
sections = []
for index, guide in enumerate(GUIDES, 1):
    guide_id = guide['id']
    count = len(coverage[guide_id])
    content = json.dumps(guide)
    assert set(coverage[guide_id]) <= set(re.findall(r'\[\[([HNP]\d+)\]\]', content)), f'Missing primary links in {guide_id}'
    nav.append(f'<a href="#{guide_id}" data-guide="{guide_id}"><span class="nav-number">{index:02}</span><span>{guide["short"]}</span><span class="nav-count">{count:02}</span></a>')
    headings = ''.join(f'<th scope="col">{heading}</th>' for heading in guide['headers'])
    rows = ''.join('<tr>' + ''.join(f'<td data-label="{guide["headers"][n]}">{render(cell)}</td>' for n, cell in enumerate(row)) + '</tr>' for row in guide['rows'])
    notes = ''.join(f'<p>{render(note)}</p>' for note in guide['notes'])
    sections.append(f'''<details class="guide" id="{guide_id}" data-count="{count}" data-primary="{' '.join(coverage[guide_id])}" open>
      <summary><span class="guide-number">{index:02}</span><span class="guide-heading"><span class="eyebrow">{guide['phase']}</span><h2>{guide['title']}</h2></span><span class="guide-count">{count} {'issue' if count == 1 else 'issues'}</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body"><p class="intro">{render(guide['intro'])}</p>
      <table><caption class="sr-only">{guide['title']}: work, issues, and dependencies</caption><thead><tr>{headings}</tr></thead><tbody>{rows}</tbody></table>
      <div class="guide-notes">{notes}</div><a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>''')

# --- Architecture reference section -----------------------------------------
STATUS_NAMES = {'implemented': 'Implemented source', 'planned': 'Planned composition', 'future': 'Future work'}
figures, diagram_index = [], []
for number, diagram in enumerate(AD.DIAGRAMS, 1):
    svg = (AD.RENDERED / f"{diagram['id']}.svg").read_text(encoding='utf-8').replace('@@DESC@@', html.escape(diagram['summary']))
    code = f'{"A" if diagram["kind"] == "architecture" else "S"}{number}'
    reading = ''.join(f'<li>{render(item)}</li>' for item in diagram['reading'])
    boundaries = ''.join(f'<li>{render(item)}</li>' for item in diagram['boundaries'])
    sources = ''.join(f'<a href="{html.escape(AD.src(repo, path), quote=True)}" target="_blank" rel="noopener noreferrer">{html.escape(REPOS[{"agent-device-hub": "H", "codex-nanoleaf": "N", "divoom-app-upgrade": "P"}[repo]][1])} {html.escape(path)}<span aria-hidden="true" class="external">↗</span></a>' for repo, path in diagram['sources'])
    issues = render(' '.join(f'[[{key}]]' for key in diagram['issues']))
    viewer = f"architecture/{diagram['id']}.html"
    diagram_index.append(f'<a href="#{diagram["id"]}">{code} · {html.escape(diagram["short"])}</a>')
    figures.append(f'''<figure class="diagram" id="{diagram['id']}" data-kind="{diagram['kind']}" data-status="{diagram['status']}" data-code="{code}">
      <figcaption><div class="diagram-head"><span class="diagram-number" aria-hidden="true">{code}</span><div class="diagram-heading"><span class="status status-{diagram['status']}">{html.escape(diagram['status_label'])}</span><h3>{html.escape(diagram['spec']['meta']['title'])}</h3></div></div>
      <p class="diagram-summary">{html.escape(diagram['summary'])}</p></figcaption>
      <div class="diagram-tools" role="group" aria-label="Controls for diagram {code}"><button type="button" class="zoom-out" aria-label="Zoom out">−</button><button type="button" class="zoom-fit">Fit</button><button type="button" class="zoom-in" aria-label="Zoom in">+</button><span class="zoom-level" aria-live="polite">100%</span><button type="button" class="viewer-toggle" aria-expanded="false" data-src="{viewer}" data-title="Interactive Archify viewer for {html.escape(diagram['spec']['meta']['title'], quote=True)}">Explore inline</button><a class="viewer-link" href="{viewer}" target="_blank" rel="noopener noreferrer">Open interactive viewer <span aria-hidden="true" class="external">↗</span></a></div>
      <div class="diagram-stage" tabindex="0" aria-label="Scrollable diagram {code}: {html.escape(diagram['spec']['meta']['title'], quote=True)}"><div class="diagram-canvas">{svg}</div></div>
      <div class="viewer-frame" hidden></div>
      <div class="diagram-text"><div><h4>How to read it</h4><ul>{reading}</ul></div><div><h4>Boundaries and evidence</h4><ul>{boundaries}</ul></div>
      <p class="diagram-sources"><span>Pinned sources:</span> {sources}</p><p class="diagram-issues"><span>Related issues (reference only, not counted):</span> {issues}</p></div></figure>''')

architecture_section = f'''<details class="reference" id="architecture" data-diagrams="{len(AD.DIAGRAMS)}" open>
      <summary><span class="guide-number">A</span><span class="guide-heading"><span class="eyebrow">Reference · not a work guide</span><h2>Architecture and sequence diagrams</h2></span><span class="guide-count">{len(AD.DIAGRAMS)} diagrams</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body"><p class="intro">Three system diagrams and six sequence diagrams show the implemented local paths, the Nanoleaf Linux installation plan, and how the planned shared system composes them. Nanoleaf PR #57 has since delivered Linux source; installation remains unverified in {render('[[N55]]')}. The unchanged architecture viewers retain their dated proposal labels and source pins. Sources were reviewed at <time datetime="{html.escape(AD.SOURCES['reviewedAt'])}">@@REVIEW_TIMESTAMP@@</time> against the pinned revisions listed on each diagram. Repository history was read separately at @@HISTORY_TIMESTAMP@@; its main revisions may be newer than the architecture review. Diagram links repeat issues that already belong to a work guide; they add nothing to the issue totals. Each figure has zoom and fit controls, a scrollable stage, a text explanation and a link to the full interactive Archify viewer shipped beside this file in the architecture folder. Those viewers are Archify's own HTML: they reference one Google Fonts stylesheet and fall back to system fonts when offline; this guide itself loads nothing remote.</p>
      <div class="status-legend" aria-label="Status key"><span class="status status-implemented">Implemented source</span><span class="status status-planned">Planned composition</span><span class="status status-future">Future work</span><span class="status-note">Implemented means reviewed source at the pinned revision. It is not installed-client, transport or physical evidence.</span></div>
      <nav class="diagram-index" aria-label="Diagrams">{''.join(diagram_index)}</nav>
      {''.join(figures)}
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''

# --- Timeline: where we've been, where we're going --------------------------
totals = TIMELINE['totals']
timeline_section = f'''<details class="reference timeline" id="timeline" open>
      <summary><span class="guide-number">T</span><span class="guide-heading"><span class="eyebrow">Map · where we've been and where we're going</span><h2>Delivery history and ordered roadmap</h2></span><span class="guide-count">{totals['merged']} merged</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body">
      <div class="chips" role="group" aria-label="Highlight a repository"><button type="button" class="repo-chip" data-repo="all" aria-pressed="true">All</button><button type="button" class="repo-chip repo-H" data-repo="H" aria-pressed="false">Hub</button><button type="button" class="repo-chip repo-N" data-repo="N" aria-pressed="false">Nanoleaf</button><button type="button" class="repo-chip repo-P" data-repo="P" aria-pressed="false">Pixoo</button></div>
      <div class="timeline-grid">
      <section class="timeline-panel" aria-labelledby="history-heading"><div class="panel-head"><h3 id="history-heading">Where we've been</h3><span class="eyebrow">Dated · merged pull requests on main</span></div>
      <div class="stats-row" aria-label="History totals"><div class="stat"><strong>{totals['merged']}</strong><span>MERGED PRS</span></div><div class="stat"><strong>{totals['closed']}</strong><span>CLOSED ISSUES</span></div><div class="stat"><strong>{totals['commits']}</strong><span>MAIN COMMITS</span></div></div>
      <div class="chart-wrap">{TIMELINE['history']}</div>
      <div class="chart-legend"><span class="legend-pr">● merged PR (hover or focus for the title; click opens GitHub)</span><span class="legend-milestone">◎ named delivery baseline</span><span class="legend-snapshot">┆ backlog snapshot</span></div>
      <p class="timeline-note">History read from GitHub at <time datetime="{html.escape(HISTORY['fetchedAt'])}">@@HISTORY_TIMESTAMP@@</time>: pull requests merged to main and issues closed since each repository was created. Local time is America/New_York. Merged means reviewed source on main; installed-client, transport and physical evidence are recorded separately in the guides.</p></section>
      <section class="timeline-panel" aria-labelledby="roadmap-heading"><div class="panel-head"><h3 id="roadmap-heading">Where we're going</h3><span class="eyebrow">Ordered · not dated</span></div>
      <div class="chart-wrap roadmap-wrap">{TIMELINE['roadmap']}</div>
      <div class="chart-legend"><span class="legend-same">── order within a track</span><span class="legend-cross">┄┄ cross-track prerequisite (hover a node to highlight)</span><span class="legend-ready">▣ ready for selection now</span></div>
      <p class="timeline-note">Every one of the {TOTAL} open issues appears exactly once on this map, in its primary guide's track. Columns show relative order within each track. Arrows identify sequence and cross-track prerequisites; sharing a column does not make an independent track wait for the Codex milestone. Columns are not dates and imply no schedule. Click a node to open its work guide.</p></section>
      </div><div id="timeline-tip" class="timeline-tip" role="status" hidden></div>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''

CSS = '''
:root{color-scheme:dark;--bg:#05070d;--panel:#080c16;--text:#d7e3ff;--muted:#93a6cc;--accent:#22d3ee;--magenta:#e879f9;--lime:#b5ed86;--edge:rgba(34,211,238,.2);--font:Bahnschrift,"Segoe UI",system-ui,sans-serif;--mono:"Cascadia Mono",Consolas,ui-monospace,monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 var(--font);background-image:linear-gradient(rgba(34,211,238,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.025) 1px,transparent 1px);background-size:32px 32px}a{color:var(--accent);text-underline-offset:4px}button,input{font:inherit}button{cursor:pointer}::selection{background:var(--accent);color:#04121a}:focus-visible{outline:2px solid white;outline-offset:5px}button,a,summary{touch-action:manipulation}button{color:var(--text);border:1px solid var(--edge);background:rgba(34,211,238,.04);border-radius:2px;padding:9px 14px;font:12px var(--mono);min-height:40px}button:hover{background:rgba(34,211,238,.12);border-color:var(--accent)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip{position:fixed;left:12px;top:-100px;z-index:100;padding:12px;background:var(--accent);color:var(--bg)}.skip:focus{top:12px}[hidden]{display:none!important}
.shell{max-width:1660px;margin:auto;display:grid;grid-template-columns:258px minmax(0,1fr);min-height:100vh}.sidebar{height:100dvh;position:sticky;top:0;padding:35px 20px 22px 26px;border-right:1px solid var(--edge);background:rgba(5,7,13,.92);display:flex;flex-direction:column;overflow:auto}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--text);font:600 13px/1.3 var(--mono);letter-spacing:.08em}.brand svg{width:35px;height:38px;color:var(--accent);flex-shrink:0;filter:drop-shadow(0 0 9px #22d3ee55)}.brand small{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.13em;margin-top:5px}.sidebar-rule{height:1px;background:linear-gradient(90deg,var(--accent),transparent);margin:31px 0 28px}.eyebrow{font:11px/1.5 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.nav-title{margin-bottom:16px;color:var(--accent)}nav{display:grid;gap:5px}nav a{display:grid;grid-template-columns:22px 1fr 20px;gap:8px;align-items:center;padding:11px 8px;border:1px solid transparent;text-decoration:none;color:var(--muted);font-size:12px;line-height:1.45;min-height:46px}nav a:hover,nav a[aria-current="location"]{color:var(--text);background:#22d3ee0b;border-color:var(--edge)}nav a[aria-current="location"]{box-shadow:inset 2px 0 var(--accent)}.nav-number{font:11px var(--mono);color:var(--accent)}.nav-count{font:10px var(--mono);color:var(--muted);opacity:.85;text-align:right}.sidebar-foot{margin-top:auto;padding-top:32px;color:var(--muted);font:10px/1.8 var(--mono)}.sidebar-foot span{display:block}.snapshot-dot{display:inline-block;width:5px;height:5px;background:var(--magenta);margin-right:6px;box-shadow:0 0 8px #e879f955}
main{min-width:0;padding:0 52px 38px}.topbar{height:73px;border-bottom:1px solid var(--edge);display:flex;justify-content:space-between;align-items:center;gap:20px}.breadcrumb{font:11px var(--mono);letter-spacing:.06em;color:var(--muted)}.breadcrumb span{color:var(--accent)}.topbar .date{font:10px var(--mono);letter-spacing:.08em;color:var(--muted)}.hero{position:relative;overflow:hidden;padding:53px 0 32px;isolation:isolate}.hero::before{content:"";position:absolute;z-index:-1;width:490px;height:340px;right:-140px;top:0;background:radial-gradient(ellipse,#22d3ee12,transparent 65%)}.hero .eyebrow{color:var(--accent)}h1{font-size:clamp(38px,4.8vw,67px);font-weight:600;line-height:1.07;letter-spacing:-.04em;margin:16px 0 20px;max-width:720px}h1 span{color:var(--accent);text-shadow:0 0 38px #22d3ee24}.hero-copy{color:var(--muted);max-width:600px;margin:0;font-size:16px;line-height:1.75}.hero-art{position:absolute;width:240px;height:210px;right:3px;top:49px;opacity:.8;z-index:-1}.stats{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--edge);margin:29px 0 0;max-width:710px;background:#080c16e8}.stat{padding:18px 23px}.stat+.stat{border-left:1px solid var(--edge)}.stat strong{display:block;font:400 34px/1.15 var(--mono);color:var(--text);letter-spacing:-.07em}.stat span{display:block;margin-top:7px;color:var(--muted);font:10px var(--mono);letter-spacing:.1em}.repo-legend{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0 0;font:11px var(--mono);color:var(--muted)}.repo-legend b{font-weight:500}.repo-H{--repo:var(--accent)}.repo-N{--repo:var(--magenta)}.repo-P{--repo:var(--lime)}.repo-legend a{color:var(--repo);text-decoration:none}.repo-legend a::before{content:"";display:inline-block;width:6px;height:6px;background:var(--repo);margin-right:7px;box-shadow:0 0 8px color-mix(in srgb,var(--repo) 30%,transparent)}
.overview{margin:8px 0 27px;padding:23px 24px;border:1px solid var(--edge);border-left:2px solid var(--accent);background:linear-gradient(105deg,#22d3ee0a,transparent 75%)}.overview p{font-size:13px;color:var(--muted);margin:12px 0 0;max-width:850px}.path{display:flex;align-items:center;gap:9px 13px;flex-wrap:wrap;margin-top:13px}.path a{text-decoration:none;font-size:13px;color:var(--text);border-bottom:1px solid #22d3ee45}.path a:hover{color:var(--accent)}.path .arrow{color:var(--accent);font:14px var(--mono)}.document-note{font:12px/1.8 var(--font);color:var(--muted);margin:0 0 28px;max-width:950px}.document-note strong{color:var(--text);font-weight:500}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 0;border-top:1px solid var(--edge);border-bottom:1px solid var(--edge);margin-bottom:12px;background:var(--bg)}.search-wrap{flex:1;min-width:215px;position:relative}.search-wrap svg{position:absolute;left:13px;top:13px;width:15px;height:15px;color:var(--accent)}input[type=search]{appearance:none;width:100%;min-height:42px;border:1px solid var(--edge);border-radius:2px;background:var(--panel);color:var(--text);padding:10px 12px 10px 38px;font:12px var(--font)}input::placeholder{color:var(--muted)}.search-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font:11px var(--mono);color:var(--muted);padding:7px 0 17px}.search-meta a{font-size:11px}.empty-state{padding:50px 24px;border:1px dashed var(--edge);text-align:center}.empty-state h2{font-size:20px}.empty-state p{color:var(--muted)}
.guide{position:relative;border:1px solid var(--edge);background:rgba(8,12,22,.94);margin:0 0 23px;scroll-margin-top:22px}.guide::before{content:"";position:absolute;top:-1px;left:-1px;width:16px;height:16px;border-top:2px solid var(--accent);border-left:2px solid var(--accent);pointer-events:none}.guide summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:18px;padding:24px 25px}.guide summary::-webkit-details-marker{display:none}.guide summary:hover{background:#22d3ee05}.guide-number{color:var(--accent);font:400 25px/1 var(--mono);letter-spacing:-.09em;min-width:31px}.guide-heading{flex:1;min-width:0}.guide-heading .eyebrow{font-size:9px;letter-spacing:.12em;color:var(--magenta)}h2{font-size:19px;line-height:1.4;font-weight:500;letter-spacing:-.01em;margin:4px 0 0}.guide-count{font:10px var(--mono);white-space:nowrap;color:var(--muted);padding:5px 7px;border:1px solid #93a6cc26}.chevron{font:20px var(--mono);color:var(--accent);min-width:12px}.guide:not([open]) .chevron{font-size:0}.guide:not([open]) .chevron::after{content:"+";font-size:20px}.guide-body{padding:0 25px 22px}.intro{margin:0 0 19px;color:var(--muted);font-size:14px;line-height:1.85}.issue{display:inline-flex;gap:6px;align-items:center;white-space:nowrap;border:1px solid color-mix(in srgb,var(--repo) 27%,transparent);background:color-mix(in srgb,var(--repo) 5%,transparent);color:var(--repo);padding:4px 7px;margin:3px 4px 3px 0;border-radius:2px;text-decoration:none;font:11px/1.5 var(--mono);vertical-align:middle}.issue:hover{border-color:var(--repo);background:color-mix(in srgb,var(--repo) 12%,transparent);box-shadow:0 0 12px color-mix(in srgb,var(--repo) 9%,transparent)}.external{font-size:11px;opacity:.65}.issue .sr-only{font-size:0}.intro .issue,.guide-notes .issue,.recommendation .issue{font-size:11px;padding:1px 6px;line-height:1.5}.guide table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.75;table-layout:fixed}th{font:10px/1.5 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:11px 12px;background:#22d3ee07;border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)}th:nth-child(1){width:25%}th:nth-child(2){width:28%}th:nth-child(3){width:47%}td{padding:13px 12px;vertical-align:top;border-bottom:1px solid #22d3ee15;color:#b5c4e1;overflow-wrap:anywhere}td:first-child{color:var(--text);font-weight:500}tbody tr:hover{background:#22d3ee03}.guide-notes{margin-top:18px;padding-left:15px;border-left:1px solid #e879f960}.guide-notes p{color:var(--muted);font-size:12px;line-height:1.9;margin:9px 0}.guide-notes strong{color:var(--text);font-weight:500}.back-top{display:inline-block;margin-top:15px;font:10px var(--mono);letter-spacing:.04em;color:var(--muted);text-decoration:none}.back-top:hover{color:var(--accent)}.back-top span{color:var(--accent);margin-left:5px}
.recommendation{position:relative;padding:27px;margin:38px 0 27px;border:1px solid #e879f955;background:linear-gradient(110deg,#e879f909,transparent 75%)}.recommendation .eyebrow{color:var(--magenta)}.recommendation h2{font-size:24px;margin:7px 0 12px}.recommendation p{max-width:890px;font-size:14px;color:var(--muted);line-height:1.9;margin:10px 0}.recommendation strong{color:var(--text);font-weight:500}.footer{display:flex;align-items:flex-start;justify-content:space-between;gap:25px;border-top:1px solid var(--edge);padding-top:22px;font:10px/1.8 var(--mono);color:var(--muted)}.footer p{margin:0;max-width:720px}.footer a{white-space:nowrap;text-decoration:none}.print-only{display:none}
@media(min-width:1500px){main{padding-left:64px;padding-right:64px}.guide table{font-size:13px}.issue{font-size:12px}.hero-art{right:24px}}@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary{padding:20px;gap:13px}.guide-body{padding:0 20px 20px}.guide-count{display:none}.guide table{font-size:12px}th:nth-child(1){width:24%}th:nth-child(2){width:30%}th:nth-child(3){width:46%}}
@media(max-width:900px){.shell{display:block}.sidebar{height:auto;position:relative;padding:20px 24px;border-right:0;border-bottom:1px solid var(--edge);display:block;overflow:visible}.brand svg{width:26px;height:29px}.brand small{display:none}.sidebar-rule,.sidebar-foot,.nav-title{display:none}nav{display:flex;overflow-x:auto;gap:7px;padding:17px 1px 2px;margin-right:-5px;scrollbar-width:thin}nav a{display:flex;flex-shrink:0;border-color:var(--edge);min-height:38px;padding:8px 10px;font-size:11px}nav .nav-count{display:none}.topbar{height:62px}.hero{padding-top:33px}.hero-art{right:0;opacity:.35}.hero-copy{max-width:580px}.stats{max-width:none}main{padding:0 25px 30px}.guide{scroll-margin-top:15px}.guide summary{padding:22px}.guide-count{display:inline-block}.guide-heading h2{font-size:19px}}
@media(max-width:600px){body{font-size:14px}.sidebar{padding:18px 17px}main{padding:0 17px 28px}.topbar{height:57px}.breadcrumb{font-size:10px}.topbar .date{font-size:9px}.hero{padding:33px 0 27px}.hero .eyebrow{font-size:9px}.hero-art{width:200px;height:185px;right:-80px;top:40px;opacity:.21}h1{font-size:42px}.hero-copy{font-size:14px}.stats{margin-top:24px}.stat{padding:16px 12px}.stat strong{font-size:29px}.stat span{font-size:8px;letter-spacing:.06em}.repo-legend{gap:12px;font-size:10px}.overview{padding:19px 17px;margin-top:4px}.overview .eyebrow{font-size:10px}.path{gap:8px}.path a{font-size:12px}.overview p{font-size:12px}.document-note{font-size:11px;line-height:1.9}.toolbar{gap:8px}.search-wrap{flex-basis:100%}.toolbar button{flex:1;font-size:10px;padding:8px 7px}.search-meta{font-size:9px;align-items:flex-start}.guide summary{align-items:flex-start;padding:21px 16px;gap:12px}.guide-number{font-size:22px;padding-top:4px;min-width:25px}.guide-heading h2{font-size:17px}.guide-heading .eyebrow{font-size:8px}.guide-count{display:none}.guide-body{padding:0 16px 20px}.intro{font-size:13px}.guide table,.guide tbody,.guide tr,.guide td{display:block;width:100%}.guide thead{display:none}.guide tr{padding:13px 0 14px;border-top:1px solid var(--edge)}.guide td{border:0;padding:4px 0}.guide td:first-child{font-size:13px;font-weight:600}.guide td:nth-child(2){padding-bottom:5px}.guide td:last-child{font-size:12px}.guide-notes{margin-top:15px;padding-left:12px}.recommendation{padding:22px 18px;margin-top:30px}.recommendation h2{font-size:22px}.recommendation p{font-size:13px}.footer{display:block;font-size:9px}.footer a{display:inline-block;margin-top:14px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
/* Reference sections (timeline, architecture) share the guide frame but are not counted work guides. */
.nav-rule{height:1px;background:linear-gradient(90deg,var(--edge),transparent);margin:8px 0 4px}nav a[data-section] .nav-number{color:var(--magenta)}
.reference .guide-heading .eyebrow{color:var(--accent)}.reference .guide-number{color:var(--magenta)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.repo-chip{padding:6px 12px;min-height:34px;font-size:11px}.repo-chip[aria-pressed="true"]{border-color:var(--repo,var(--accent));background:color-mix(in srgb,var(--repo,var(--accent)) 14%,transparent);color:var(--text)}
.timeline-grid{display:grid;gap:26px;min-width:0}.timeline-panel,.reference .guide-body,.diagram,.diagram-text>*{min-width:0}.panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 10px}.panel-head h3{font-size:16px;font-weight:500;margin:0}.panel-head .eyebrow{font-size:9px}
.stats-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--edge);margin:0 0 12px;max-width:520px;background:#080c16e8}.stats-row .stat{padding:12px 16px;min-width:0}.stats-row .stat strong{font-size:24px}.stats-row .stat span{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history .leader{stroke:var(--muted);stroke-width:.8;opacity:.7}
.chart-wrap{overflow-x:auto;border:1px solid var(--edge);background:#060a14;padding:10px;scrollbar-width:thin}.chart-wrap svg{display:block;width:100%;min-width:640px;height:auto;font-family:var(--mono)}.roadmap-wrap svg{min-width:960px}
.history .tick{stroke:#22d3ee1c}.history .tick.major{stroke:#22d3ee55}.history .tick-label{fill:var(--muted);font-size:10px}.history .row-line{stroke:#93a6cc2e}.history .row-label{font-size:12px;fill:var(--repo);font-weight:600}.history .row-meta{font-size:9px;fill:var(--muted)}
.history .repo-start line{stroke:var(--muted);stroke-dasharray:2 3}.history .repo-start text{font-size:8px;fill:var(--muted)}.history .snapshot-line{stroke:var(--magenta);stroke-dasharray:4 4}.history .snapshot-label{font-size:9px;fill:var(--magenta)}
.history .pr circle{fill:var(--repo);fill-opacity:.9;stroke:#05070d;stroke-width:2;transition:r .12s}.history .pr.milestone circle{fill:#05070d;stroke:var(--repo);stroke-width:2.5}.history .pr:hover circle,.history .pr:focus circle{r:9}.history .pr:focus{outline:none}.history .milestone-label{font-size:8.5px;fill:var(--text)}
.roadmap .slot{fill:transparent}.roadmap .slot.even{fill:#22d3ee06}.roadmap .slot-label{font-size:9.5px;fill:var(--muted);letter-spacing:.06em;text-transform:uppercase}.roadmap .track-label{font-size:11px;fill:var(--muted)}.roadmap .track-label.main{fill:var(--accent)}
.roadmap .edge{stroke:#93a6cc66;fill:none;stroke-width:1.4}.roadmap .edge.cross{stroke:#e879f966;stroke-dasharray:5 4}.roadmap .edge.lit{stroke:var(--accent);stroke-width:2.4;stroke-dasharray:none}.roadmap marker path{fill:#93a6cc99}
.roadmap .node rect{fill:#0b1120;stroke:#93a6cc55;stroke-width:1}.roadmap .node.main rect{stroke:var(--accent);stroke-width:1.4}.roadmap .node.ready rect{fill:#22d3ee16;stroke:var(--accent);stroke-width:1.6}.roadmap .node:hover rect,.roadmap .node:focus rect{stroke:var(--text);filter:drop-shadow(0 0 8px #22d3ee66)}.roadmap .node:focus{outline:none}
.roadmap .node-label{font-size:11px;fill:var(--text);font-weight:500}.roadmap .node-meta{font-size:8.5px;fill:var(--muted)}.timeline .dim{opacity:.16}
.timeline-tip{position:absolute;z-index:5;transform:translate(-50%,-100%);max-width:340px;background:#0b1120;border:1px solid var(--accent);padding:8px 11px;font:11px/1.55 var(--font);color:var(--text);pointer-events:none;box-shadow:0 0 22px #22d3ee33}.timeline-tip strong{display:block;color:var(--accent)}.timeline-tip span,.timeline-tip em{display:block;color:var(--muted);font-style:normal}
.chart-legend{display:flex;gap:18px;flex-wrap:wrap;font:10px var(--mono);color:var(--muted);margin:8px 0 0}.timeline-note{font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.85}.timeline .guide-body{position:relative}
.status-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:0 0 16px;font:10px var(--mono);color:var(--muted)}.status-note{flex-basis:100%;font:11px var(--font);color:var(--muted)}.status{font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.status::before{content:"";display:inline-block;width:8px;height:8px;margin-right:7px;vertical-align:1px}.status-implemented::before{background:var(--lime)}.status-planned::before{background:var(--accent)}.status-future::before{background:var(--magenta)}
.diagram-index{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 22px;font-size:12px}.diagram-index a{text-decoration:none;border-bottom:1px solid #22d3ee45}.diagram-index a:hover{color:var(--text)}
.diagram{margin:0 0 34px;padding:20px 0 0;border-top:1px solid var(--edge)}.diagram-head{display:flex;gap:14px;align-items:flex-start}.diagram-number{font:400 20px/1 var(--mono);color:var(--magenta);min-width:36px;padding-top:5px}.diagram h3{font-size:17px;font-weight:500;margin:3px 0 0;line-height:1.4}.diagram-summary{color:var(--muted);font-size:13px;line-height:1.8;margin:10px 0 12px;max-width:900px}
.diagram-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.diagram-tools button{min-height:34px;padding:6px 12px}.zoom-level{font:11px var(--mono);color:var(--muted);min-width:44px}.viewer-link{font:11px var(--mono);margin-left:auto;text-decoration:none;border-bottom:1px solid #22d3ee45}
.diagram-stage{overflow:auto;max-height:700px;border:1px solid var(--edge);background:#060a14;cursor:grab;scrollbar-width:thin}.diagram-stage.dragging{cursor:grabbing;user-select:none}.diagram-stage:focus-visible{outline-offset:-2px}.diagram-canvas{min-width:100%}.diagram-canvas>svg{display:block;width:100%;height:auto;font-family:var(--font)}
.viewer-frame iframe{width:100%;height:640px;border:1px solid var(--edge);background:#000;margin-top:8px}
.diagram-text{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:16px 24px}.diagram-text h4{font:10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 7px}.diagram-text ul{margin:0;padding-left:18px;font-size:12px;line-height:1.75;color:#b5c4e1}.diagram-text li{margin:0 0 6px}
.diagram-sources,.diagram-issues{grid-column:1/-1;font:11px/2.1 var(--mono);color:var(--muted);margin:0}.diagram-sources a{margin-right:12px;text-decoration:none;border-bottom:1px solid #22d3ee45}.diagram-sources span,.diagram-issues span{color:var(--text);margin-right:8px}
@media(max-width:900px){.diagram-text{grid-template-columns:1fr}.diagram-stage{max-height:480px}.stats-row{max-width:none}.viewer-frame iframe{height:480px}.repo-chip{flex:1}}
@media(max-width:600px){.stats-row .stat span{white-space:normal;font-size:8px}.diagram-head{gap:10px}.diagram-number{font-size:16px;min-width:28px}.diagram h3{font-size:15px}.diagram-tools button{padding:6px 9px}.viewer-link{margin-left:0;flex-basis:100%}.timeline-tip{max-width:240px}.chart-wrap{padding:6px}}
@media print{.reference,.reference[hidden]{display:block!important;background:white;border:1px solid #bdc6cd;margin:0 0 19px;overflow:visible}.reference summary{display:flex;padding:15px 16px;break-after:avoid;cursor:default}.reference .guide-number{color:#7b2c8a}.chips,.timeline-tip,.diagram-tools,.viewer-frame,.chart-legend .legend-pr{display:none!important}
.diagram{break-inside:avoid;border-color:#cbd2d8}.diagram-stage{max-height:none;overflow:visible;border:1px solid #cbd2d8;background:white;cursor:default}.diagram-canvas>svg{width:100%!important;max-height:165mm}.diagram h3,.diagram-text ul,.diagram-sources span,.diagram-issues span{color:#17212e}.diagram-number{color:#7b2c8a}.diagram-summary,.diagram-text ul,.diagram-sources,.diagram-issues,.timeline-note,.chart-legend,.status,.status-legend{color:#384756}.diagram-text h4{color:#1b6872}.diagram-sources a{color:#145565;border:0}
.chart-wrap{overflow:visible;border-color:#cbd2d8;background:white;break-inside:avoid}.chart-wrap svg{min-width:0}.stats-row{background:transparent;border-color:#abb5bc}.stats-row .stat strong{color:#17212e}.stats-row .stat span{color:#384756}
.history .tick{stroke:#d5dde3}.history .tick.major{stroke:#9aa8b3}.history .tick-label,.history .row-meta,.history .repo-start text{fill:#384756}.history .row-line{stroke:#c3ccd3}.history .pr circle{stroke:white}.history .pr.milestone circle{fill:white}.history .milestone-label{fill:#17212e}.history .snapshot-line{stroke:#7b2c8a}.history .snapshot-label{fill:#7b2c8a}.history .row-label{fill:#17212e}
.roadmap .slot.even{fill:#f1f5f7}.roadmap .slot-label,.roadmap .track-label,.roadmap .node-meta{fill:#384756}.roadmap .track-label.main{fill:#1b6872}.roadmap .edge{stroke:#8a9ba8}.roadmap .edge.cross{stroke:#a06bb0}.roadmap marker path{fill:#8a9ba8}.roadmap .node rect{fill:white;stroke:#8a9ba8}.roadmap .node.main rect,.roadmap .node.ready rect{stroke:#1b6872}.roadmap .node.ready rect{fill:#e6f4f7}.roadmap .node-label{fill:#17212e}.timeline .dim{opacity:1}}
'''
# Archify's SVG classes, scoped to the embedded canvases. Dark values follow the
# viewer's default theme with the guide's text colors; print uses the light theme.
def scope(selector):
    return ', '.join(f'.diagram-canvas {part.strip()}' for part in selector.split(','))
ARCHIFY_CSS = ''.join(f'{scope(selector)}{{{body}}}' for selector, body in ARCHIFY_CLASSES['rules'].items())
dark_vars = dict(ARCHIFY_CLASSES['dark'], **{'--bg': '#060a14', '--grid': '#12233a', '--text': '#e6efff', '--text-muted': '#9fb1cc', '--text-dim': '#6b7f9c', '--text-faint': '#8496b3'})
light_vars = ARCHIFY_CLASSES['light']
CSS += ARCHIFY_CSS + '.diagram-canvas{' + ';'.join(f'{k}:{v}' for k, v in dark_vars.items()) + '}@media print{.diagram-canvas{' + ';'.join(f'{k}:{v}' for k, v in light_vars.items()) + '}}\n'
CSS = CSS.replace('.guide{position:relative;', '.guide,.reference{position:relative;').replace('.guide::before{', '.guide::before,.reference::before{').replace('.guide summary{list-style', '.guide summary,.reference summary{list-style').replace('.guide summary::-webkit-details-marker{', '.guide summary::-webkit-details-marker,.reference summary::-webkit-details-marker{').replace('.guide summary:hover{', '.guide summary:hover,.reference summary:hover{').replace('.guide:not([open]) .chevron{', '.guide:not([open]) .chevron,.reference:not([open]) .chevron{').replace('.guide:not([open]) .chevron::after{', '.guide:not([open]) .chevron::after,.reference:not([open]) .chevron::after{')
CSS = CSS.replace('@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary{', '@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary,.reference summary{').replace('.guide{scroll-margin-top:15px}.guide summary{padding:22px}', '.guide,.reference{scroll-margin-top:15px}.guide summary,.reference summary{padding:22px}').replace('.guide summary{align-items:flex-start;padding:21px 16px;gap:12px}', '.guide summary,.reference summary{align-items:flex-start;padding:21px 16px;gap:12px}')
assert CSS.count('.reference summary') >= 5, 'Reference selectors missing'
CSS += '''
@media print{@page{size:A4;margin:16mm}html{scroll-behavior:auto}body{background:white!important;color:#17212e!important;font:10pt/1.5 Arial,sans-serif}.sidebar,.topbar,.hero-art,.toolbar,.search-meta,.overview,.back-top,.chevron,.empty-state,.skip,.footer>a{display:none!important}.shell{display:block}main{padding:0}.hero{padding:0 0 18px;overflow:visible}.hero::before{display:none}h1{font-size:31pt;margin:10px 0}h1 span{color:#153542!important;text-shadow:none}.hero-copy,.document-note,.guide-notes p,.intro,.recommendation p,.footer{color:#384756!important}.eyebrow,.guide-heading .eyebrow{color:#465767!important}.stats{max-width:100%;background:transparent;border-color:#abb5bc;margin:18px 0 0}.stat{padding:12px 15px}.stat+.stat{border-color:#abb5bc}.stat strong{font-size:23pt;color:#17212e}.stat span{color:#384756}.repo-legend{margin:12px 0}.repo-legend a{color:#17212e}.repo-legend a::before{box-shadow:none;background:#475c6c}.guide,.guide[hidden]{display:block!important;background:white;border:1px solid #bdc6cd;margin:0 0 19px;overflow:visible}.guide::before{display:none}.guide summary{display:flex;padding:15px 16px;break-after:avoid;cursor:default}.guide-heading h2{font:600 15pt/1.3 Arial,sans-serif;color:#17212e}.guide-number{color:#1b6872;font-size:18pt}.guide-count{color:#384756;border-color:#bdc6cd}.guide-body{padding:0 16px 15px}.guide table{display:table;table-layout:fixed;font-size:9pt}.guide thead{display:table-header-group}.guide tbody{display:table-row-group}.guide tr{display:table-row;break-inside:avoid}.guide th,.guide td{display:table-cell;width:auto;padding:8px;line-height:1.55;color:#263b4a;border-color:#cbd2d8}.guide th{background:#edf2f4;color:#344553}.guide th:nth-child(1){width:25%}.guide th:nth-child(2){width:28%}.guide th:nth-child(3){width:47%}.guide td:first-child{color:#17212e}.issue{color:#145565!important;background:transparent;border:1px solid #b9cbd0;font:8pt/1.4 Consolas,monospace;padding:2px 4px;box-shadow:none!important}.external{display:none}.intro .issue,.guide-notes .issue,.recommendation .issue{font-size:8pt}.guide-notes{border-color:#879ca8}.guide-notes p{font-size:9pt}.guide-notes strong,.recommendation strong{color:#17212e}.recommendation{background:white;border-color:#879ca8;break-inside:avoid;margin:20px 0}.recommendation h2{color:#17212e}.footer{font-size:8pt;border-color:#879ca8}.print-only{display:block;font:9pt/1.5 Arial,sans-serif;color:#384756}.document-note{font-size:9pt}}
'''

JS = '''
(() => {
 // .guide elements are the counted work guides; .reference sections (timeline,
 // architecture) share expand/collapse, navigation, search and print handling
 // without joining the issue accounting.
 const guides = [...document.querySelectorAll('.guide')];
 const refs = [...document.querySelectorAll('.reference')];
 const sections = [...guides, ...refs];
 const figures = [...document.querySelectorAll('.diagram')];
 const architecture = document.querySelector('#architecture');
 const timeline = document.querySelector('#timeline');
 const navLinks = [...document.querySelectorAll('nav a')];
 const navId = a => a.dataset.guide || a.dataset.section;
 const navById = new Map(navLinks.map(a => [navId(a), a]));
 const search = document.querySelector('#search');
 const result = document.querySelector('#result-count');
 const empty = document.querySelector('#empty-state');
 const clear = document.querySelector('#clear-search');
 const normal = value => value.toLocaleLowerCase().replace(/\\s+/g, ' ').trim();
 const haystacks = new Map([...guides, ...figures].map(g => [g, normal(g.textContent)]));
 const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
 const snapshot = () => ({open: sections.map(s => s.open), hidden: sections.map(s => s.hidden), figures: figures.map(f => f.hidden), nav: navLinks.map(a => a.hidden)});
 const restore = state => { sections.forEach((s, i) => { s.open = state.open[i]; s.hidden = state.hidden[i]; }); figures.forEach((f, i) => f.hidden = state.figures[i]); navLinks.forEach((a, i) => a.hidden = state.nav[i]); };
 let saved = null;
 function filter() {
   const query = normal(search.value);
   if (query && !saved) saved = snapshot();
   let count = 0, issues = 0, diagrams = 0;
   if (query) {
     guides.forEach(g => { const show = haystacks.get(g).includes(query); g.hidden = !show; navById.get(g.id).hidden = !show; if (show) { count++; issues += Number(g.dataset.count); g.open = true; } });
     figures.forEach(f => { const show = haystacks.get(f).includes(query); f.hidden = !show; if (show) diagrams++; });
     architecture.hidden = diagrams === 0; navById.get('architecture').hidden = diagrams === 0; if (diagrams) architecture.open = true;
     timeline.hidden = true; navById.get('timeline').hidden = true;
   } else {
     if (saved) { restore(saved); saved = null; }
     count = guides.length; issues = guides.reduce((n, g) => n + Number(g.dataset.count), 0); diagrams = figures.length;
   }
   result.textContent = `${plural(count, 'guide')} · ${plural(issues, 'issue')} in these guides · ${plural(diagrams, 'diagram')}`;
   clear.hidden = !query; empty.hidden = count > 0 || diagrams > 0;
 }
 search.addEventListener('input', filter);
 search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; filter(); } });
 clear.addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
 document.querySelector('#expand-all').addEventListener('click', () => sections.filter(s => !s.hidden).forEach(s => s.open = true));
 document.querySelector('#collapse-all').addEventListener('click', () => sections.filter(s => !s.hidden).forEach(s => s.open = false));
 const setCurrent = id => navLinks.forEach(a => { if (navId(a) === id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
 function reveal(id) {
   const figure = figures.find(f => f.id === id);
   const target = figure ? figure.closest('.reference') : sections.find(s => s.id === id);
   if (!target) return;
   if (target.hidden || (figure && figure.hidden)) { search.value = ''; filter(); }
   const wasClosed = !target.open;
   target.open = true;
   setCurrent(target.id);
   if (figure || wasClosed) requestAnimationFrame(() => document.getElementById(id).scrollIntoView({block: 'start'}));
 }
 document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', () => reveal(a.getAttribute('href').slice(1))));
 window.addEventListener('hashchange', () => reveal(location.hash.slice(1)));
 if (location.hash) reveal(location.hash.slice(1));
 if ('IntersectionObserver' in window) {
   const observer = new IntersectionObserver(entries => {
     const visible = entries.filter(e => e.isIntersecting && !e.target.hidden).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top);
     if (visible.length) setCurrent(visible[0].target.id);
   }, {rootMargin:'0px 0px -70% 0px',threshold:0});
   sections.forEach(s => observer.observe(s));
 }
 let beforePrint = null;
 window.addEventListener('beforeprint', () => { if (!beforePrint) beforePrint = snapshot(); sections.forEach(s => {s.open = true; s.hidden = false;}); figures.forEach(f => f.hidden = false); });
 window.addEventListener('afterprint', () => { if (beforePrint) restore(beforePrint); beforePrint = null; });
 document.querySelector('#print').addEventListener('click', () => window.print());
 // Diagram zoom, fit, drag-to-pan and the optional inline Archify viewer.
 figures.forEach(figure => {
   const svg = figure.querySelector('.diagram-canvas > svg'), level = figure.querySelector('.zoom-level'), stage = figure.querySelector('.diagram-stage');
   // 100% fits the whole diagram inside the stage (width and height); zoom is relative to that fit.
   const ratio = svg.viewBox.baseVal.height / svg.viewBox.baseVal.width;
   // Wide system diagrams fit whole; tall sequence diagrams open at full width and scroll vertically inside the stage.
   const fit = () => { if (ratio > 0.9) return 1; const width = stage.clientWidth - 2, height = parseFloat(getComputedStyle(stage).maxHeight) || 700; return Math.min(1, height / (width * ratio)); };
   let scale = 1;
   const apply = () => { svg.style.width = `${Math.round(scale * fit() * 1000) / 10}%`; level.textContent = `${Math.round(scale * 100)}%`; figure.dataset.zoom = String(scale); };
   apply();
   window.addEventListener('resize', () => { if (scale === 1) apply(); });
   figure.querySelector('.zoom-in').addEventListener('click', () => { scale = Math.min(4, +(scale + 0.25).toFixed(2)); apply(); });
   figure.querySelector('.zoom-out').addEventListener('click', () => { scale = Math.max(0.5, +(scale - 0.25).toFixed(2)); apply(); });
   figure.querySelector('.zoom-fit').addEventListener('click', () => { scale = 1; apply(); stage.scrollTo(0, 0); });
   let drag = null;
   stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('a,button')) return; drag = {x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop}; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
   stage.addEventListener('pointermove', e => { if (!drag) return; stage.scrollLeft = drag.left - (e.clientX - drag.x); stage.scrollTop = drag.top - (e.clientY - drag.y); });
   const end = () => { drag = null; stage.classList.remove('dragging'); };
   stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
   const toggle = figure.querySelector('.viewer-toggle'), frame = figure.querySelector('.viewer-frame');
   toggle.addEventListener('click', () => {
     if (!frame.querySelector('iframe')) { const iframe = document.createElement('iframe'); iframe.src = toggle.dataset.src; iframe.title = toggle.dataset.title; iframe.loading = 'lazy'; frame.append(iframe); }
     frame.hidden = !frame.hidden; toggle.setAttribute('aria-expanded', String(!frame.hidden)); toggle.textContent = frame.hidden ? 'Explore inline' : 'Hide inline viewer';
   });
 });
 // Timeline: tooltips, prerequisite highlighting and repository filter.
 if (timeline) {
   const tip = document.querySelector('#timeline-tip');
   const show = el => {
     tip.replaceChildren();
     const strong = document.createElement('strong'); strong.textContent = el.dataset.tip; tip.append(strong);
     for (const text of [el.dataset.when, el.dataset.detail]) if (text) { const span = document.createElement('span'); span.textContent = text; tip.append(span); }
     if (el.dataset.guide) { const em = document.createElement('em'); em.textContent = `Guide: ${el.dataset.guide}`; tip.append(em); }
     tip.hidden = false;
     const r = el.getBoundingClientRect(), box = timeline.querySelector('.guide-body').getBoundingClientRect();
     tip.style.left = `${Math.min(Math.max(120, r.left - box.left + r.width / 2), box.width - 120)}px`;
     tip.style.top = `${Math.max(0, r.top - box.top - 8)}px`;
   };
   const hide = () => { tip.hidden = true; };
   timeline.querySelectorAll('[data-tip]').forEach(el => { el.addEventListener('mouseenter', () => show(el)); el.addEventListener('focus', () => show(el)); el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide); });
   timeline.querySelectorAll('.node').forEach(node => {
     const lit = on => timeline.querySelectorAll(`.edge[data-from="${node.dataset.node}"], .edge[data-to="${node.dataset.node}"]`).forEach(e => e.classList.toggle('lit', on));
     node.addEventListener('mouseenter', () => lit(true)); node.addEventListener('mouseleave', () => lit(false)); node.addEventListener('focus', () => lit(true)); node.addEventListener('blur', () => lit(false));
   });
   const chips = [...timeline.querySelectorAll('.repo-chip')];
   chips.forEach(chip => chip.addEventListener('click', () => {
     const repo = chip.dataset.repo;
     chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
     timeline.dataset.repo = repo;
     timeline.querySelectorAll('svg [data-repo], svg [data-repos]').forEach(el => { const repos = (el.dataset.repos ?? el.dataset.repo ?? '').split(' ').filter(Boolean); el.classList.toggle('dim', repo !== 'all' && !repos.includes(repo)); });
   }));
 }
})();
'''

document = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="description" content="@@GUIDE_COUNT@@ linked guides covering @@TOTAL@@ open issues across Agent Device Hub, Codex Nanoleaf, and Pixoo. Static snapshot refreshed @@TIMESTAMP@@.">
<title>Agent device work guides · @@MONTH_TITLE@@</title><style>''' + CSS + '''</style></head>
<body id="top"><a class="skip" href="#main">Skip to the guides</a>
<div class="shell"><aside class="sidebar" aria-label="Guide navigation">
<a class="brand" href="#top" aria-label="Agent device work guides overview"><svg viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 2 37 12v20L20 42 3 32V12Z" stroke="currentColor" stroke-width="1.5"/><path d="m3 12 17 10 17-10M20 22v20M20 2v12m-7 4 7-4 7 4" stroke="currentColor" stroke-width="1.5"/></svg><span>AGENT DEVICE<small>WORK GUIDES / @@MONTH_CODE@@</small></span></a>
<div class="sidebar-rule"></div><div class="nav-title eyebrow">Explore the work</div><nav aria-label="@@GUIDE_COUNT@@ work guides, timeline and architecture">''' + ''.join(nav) + '''<div class="nav-rule" role="presentation"></div><a href="#timeline" data-section="timeline"><span class="nav-number">T</span><span>Timeline map</span><span class="nav-count" aria-hidden="true">map</span></a><a href="#architecture" data-section="architecture"><span class="nav-number">A</span><span>Architecture</span><span class="nav-count">''' + f'{len(AD.DIAGRAMS):02}' + '''</span></a></nav>
<div class="sidebar-foot"><span><i class="snapshot-dot" aria-hidden="true"></i>BACKLOG SNAPSHOT</span><span>@@DATE@@ / @@PROJECTS_PADDED@@ PROJECTS</span><span>Issue links open GitHub ↗</span></div></aside>
<main id="main"><header class="topbar"><div class="breadcrumb"><span>PLANNING</span> / CROSS-PROJECT GUIDE</div><time class="date" datetime="@@ISO@@">@@DATE@@</time></header>
<section class="hero" aria-labelledby="document-title"><div class="eyebrow">One shared system · @@GUIDE_COUNT@@ work guides</div><h1 id="document-title">Agent device<br><span>work guides.</span></h1>
<p class="hero-copy">The remaining work across the hub, Nanoleaf, and Pixoo. Grouped by outcome, with dependencies and a practical order for delivery.</p>
<svg class="hero-art" viewBox="0 0 250 220" fill="none" aria-hidden="true"><g stroke="#22d3ee" opacity=".10" stroke-width="10"><path d="m125 20 70 40v80l-70 40-70-40V60Z"/><path d="m55 60 70 40 70-40m-70 40v80"/></g><g stroke="#22d3ee" stroke-width="1.4"><path d="m125 20 70 40v80l-70 40-70-40V60Z"/><path d="m55 60 70 40 70-40m-70 40v80"/><path d="M125 20v-9M195 140l20 12M55 140l-20 12"/></g><path d="m125 43 50 29v56l-50 29-50-29V72Z" stroke="#e879f9" opacity=".55"/><g fill="#22d3ee"><circle cx="125" cy="20" r="3"/><circle cx="195" cy="140" r="3"/><circle cx="55" cy="140" r="3"/><circle cx="125" cy="100" r="4"/></g><path d="M23 191h60m23 0h73m10 0h33M23 198h25m8 0h111" stroke="#22d3ee" opacity=".3"/></svg>
<div class="stats" aria-label="Snapshot totals"><div class="stat"><strong>@@TOTAL@@</strong><span>OPEN ISSUES</span></div><div class="stat"><strong>@@GUIDE_COUNT@@</strong><span>WORK GUIDES</span></div><div class="stat"><strong>@@PROJECTS_PADDED@@</strong><span>PROJECTS</span></div></div>
<div class="repo-legend" aria-label="Repository key"><a class="repo-H" href="https://github.com/jimmie-potts/agent-device-hub/issues" target="_blank" rel="noopener noreferrer">Hub <b>@@H_COUNT@@</b></a><a class="repo-N" href="https://github.com/jimmie-potts/codex-nanoleaf/issues" target="_blank" rel="noopener noreferrer">Nanoleaf <b>@@N_COUNT@@</b></a><a class="repo-P" href="https://github.com/jimmie-potts/divoom-app-upgrade/issues" target="_blank" rel="noopener noreferrer">Pixoo <b>@@P_COUNT@@</b></a></div></section>
<section class="overview" aria-label="Main product sequence"><div class="eyebrow">Main product sequence</div><div class="path"><a href="#local-acceptance">Local acceptance</a><span class="arrow" aria-hidden="true">→</span><a href="#shared-codex">Shared Codex integration</a><span class="arrow" aria-hidden="true">→</span><a href="#controls-music">General controls</a><span class="arrow" aria-hidden="true">→</span><a href="#controls-music">Music</a><span class="arrow" aria-hidden="true">→</span><a href="#assistant-access">Assistant</a></div><p><strong>Independent shortcut path:</strong> <a href="#desktop-controls">Desktop documentation + qualification → local Wispr/mouse controls → local acceptance</a>. This path does not wait for the shared hub. PC lighting, other device features, presentation, hosting and maintenance have their own sequences below. The <a href="#timeline">timeline map</a> shows delivered history and the ordered roadmap; the <a href="#architecture">architecture section</a> shows how the pieces fit.</p></section>
<p class="document-note"><strong>Static snapshot refreshed <time datetime="@@ISO@@">@@TIMESTAMP@@</time>.</strong> Based on explicit open-issue queries, complete pagination, current issue bodies and native prerequisites, plus direct acceptance and PR reads. Every open issue has one primary guide; repeated dependency, completed-baseline, timeline and architecture links do not add to the counts. “Pixoo” means <strong>divoom-app-upgrade</strong>. Future investigations remain deferred. This document does not refresh issue status automatically.</p>
<div class="guides references">''' + timeline_section + '''</div>
<div class="toolbar" aria-label="Document controls"><div class="search-wrap"><label class="sr-only" for="search">Search guides by topic, device, or issue</label><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.5"/></svg><input id="search" type="search" placeholder="Find a topic, device, or issue…" autocomplete="off"></div><button id="expand-all" type="button">Expand all</button><button id="collapse-all" type="button">Collapse all</button><button id="print" type="button">Print / PDF</button></div>
<div class="search-meta"><span id="result-count" role="status" aria-live="polite">@@GUIDE_COUNT@@ guides · @@TOTAL@@ issues in these guides · @@DIAGRAM_COUNT@@ diagrams</span><button id="clear-search" type="button" hidden>Clear search</button><span>Use an issue link to open its full scope ↗</span></div>
<div id="empty-state" class="empty-state" hidden><h2>No matching guides or diagrams</h2><p>Try a device name, topic, or issue such as “Pixoo #37”.</p></div>
<div class="guides">''' + ''.join(sections) + '''</div>
<div class="guides references">''' + architecture_section + '''</div>
<section class="recommendation" aria-labelledby="next-title"><div class="eyebrow">Suggested next source work</div><h2 id="next-title">Build consumers on the delivered shared host.</h2><p>''' + render('The source contract in <strong>[[H2]]</strong> is delivered. PR #77 merged the early Linux baseline and budgets for <strong>[[H30]]</strong>. <strong>[[H3]]</strong> is closed. PR #105 merged its source, agent-state 1.0.0 is released, and all five applicable merged-main checks passed after PR #108 repaired CI setup. The first host is delivered. <strong>[[P31]]</strong> is closed after PR #60 and all five merged-main checks passed. It provides private durable ownership, authenticated admission, selected-owner reads and explicit cutover. Nanoleaf [[N29]] is closed after PR #62 delivered explicit shared input through the existing worker; all nine PR and nine merged-main jobs passed. [[H8]] source setup is delivered. [[N30]] is closed after the personal Linux/WSL update, real Desktop/CLI delivery, restart checks and owner-observed task light changes. The installation finished in Work. Pixoo has a configured shared consumer and private read/control credential; its device acceptance remains separate. Pixoo dashboard [[P32]] is closed after PR #63 and all five PR and five merged-main checks passed. The renderer and authenticated preview are now connected through [[P33]], closed after PR #64 and all five PR and five merged-main jobs passed. Explicit Monitor/Media controls use the sole Player writer, while restart and screen-on remain passive. Installed-client and physical acceptance remain [[P34]]. PR #65 merged its source packaging: a pinned shared setup SDK, disposable Pixoo rehearsal and operator acceptance sequence. The owner reduced #34 to one Codex Desktop task path through Ubuntu WSL: working/completed activity, notice clearing/dismissal, a short readable Pixoo display check and basic Monitor/Media behavior. Installation and actual observations remain pending. Required CLI/Claude trials, migration, broad failure matrices and a shared-frontend trial are outside this revised scope. Remaining device consumers retain their own scope and prerequisites. The owner deferred embedded-host performance measurement and numeric acceptance to <strong>[[P61]]</strong>; it follows #31 and does not block feature delivery. Failed measurements and frozen limits remain recorded. Hub #30 remains open for the narrower standalone-only personal-use qualification. It no longer requires Pixoo #61 evidence; historical failures remain failures, and its new practical targets must precede qualification runs. <strong>[[P29]]</strong> has delivered its released-contract adoption. <strong>[[P37]]</strong> is closed after PR #58 delivered the protected shared controller boundary; frontend adoption remains with its owning issue. <strong>[[N41]]</strong> is the clearest separate feature starting point. Keep later device qualification with its owning issues. [[H63]] documentation and [[H64]] qualification are ready for future selection; this refresh starts neither.') + '''</p><p>Some blocked labels and native dependency links lag the issue bodies. Refresh readiness when selecting each issue, especially where source prerequisites have closed.</p></section>
<footer class="footer"><p>AGENT DEVICE WORK GUIDES / @@MONTH_UPPER@@<br>Source: existing GitHub planning records, refreshed @@TIMESTAMP@@.<br>This HTML refresh reads existing planning records. Earlier work created and updated those records; this refresh made no GitHub changes. Source validation, installation, real-client, transport and physical evidence remain separate. One state owner and one designated writer per device.</p><a href="#top">RETURN TO TOP ↑</a></footer>
</main></div><script>''' + JS + '''</script></body></html>'''

tokens = {
    'TOTAL': str(TOTAL), 'GUIDE_COUNT': str(len(GUIDES)), 'PROJECTS_PADDED': f'{len(REPOS):02}',
    'H_COUNT': str(COUNTS['H']), 'N_COUNT': str(COUNTS['N']), 'P_COUNT': str(COUNTS['P']),
    'TIMESTAMP': REFRESHED.strftime('%B %d, %Y at %H:%M:%S %Z'), 'ISO': SNAPSHOT['refreshedAt'],
    'DATE': REFRESHED.strftime('%d %b %Y').upper(), 'MONTH_TITLE': REFRESHED.strftime('%B %Y'),
    'MONTH_CODE': REFRESHED.strftime('%Y.%m'), 'MONTH_UPPER': REFRESHED.strftime('%B %Y').upper(),
    'DIAGRAM_COUNT': str(len(AD.DIAGRAMS)), 'REVIEW_TIMESTAMP': SOURCE_REVIEW.strftime('%B %d, %Y at %H:%M:%S %Z'),
    'HISTORY_TIMESTAMP': TIMELINE['fetched'].strftime('%B %d, %Y at %H:%M:%S %Z'),
}
for token, value in tokens.items():
    document = document.replace(f'@@{token}@@', html.escape(value, quote=True))
assert not re.search(r'@@[A-Z_]+@@', document), 'Unresolved document metadata'
metadata_json = json.dumps(METADATA, ensure_ascii=False).replace('<', r'\u003c')
document = document.replace('<script>', f'<script id="snapshot-data" type="application/json">{metadata_json}</script><script>')
referenced = set(re.findall(r'data-issue="([HNP]\d+)"', document))
assert set(all_primary) <= referenced
assert document.count('class="diagram"') == len(AD.DIAGRAMS) and document.count('<details class="guide"') == len(GUIDES)
assert 'src="http' not in document and 'href="http' not in re.sub(r'href="https://github\.com/[^"]*"', '', document), 'Only GitHub links may leave the document'
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(document, encoding='utf-8')
# Companion interactive viewers (full Archify HTML) sit beside the guide; the
# inline SVGs above keep the guide itself self-contained and printable.
VIEWERS.mkdir(parents=True, exist_ok=True)
for existing in VIEWERS.glob('*.html'):
    if existing.stem not in {d['id'] for d in AD.DIAGRAMS}:
        existing.unlink()
for diagram in AD.DIAGRAMS:
    shutil.copyfile(AD.RENDERED / f"{diagram['id']}.html", VIEWERS / f"{diagram['id']}.html")
print(json.dumps({'output': str(OUT), 'bytes': OUT.stat().st_size, 'guides': len(GUIDES), 'primary_open_issues': len(all_primary), 'linked_issues': len(referenced),
                  'diagrams': len(AD.DIAGRAMS), 'viewers': str(VIEWERS), 'roadmap_nodes': TIMELINE['meta']['roadmapNodes'], 'merged_prs': TIMELINE['totals']['merged']}))
