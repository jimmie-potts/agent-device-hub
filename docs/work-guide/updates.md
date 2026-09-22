## September 22, 2026: Nanoleaf native controls delivered

Nanoleaf #64 closed as completed after
[codex-nanoleaf PR #66](https://github.com/jimmie-potts/codex-nanoleaf/pull/66)
merged as `80628498136203a8f5fcb06ab5fa306e961e2def` (reviewed head `468b797`,
identical tree) and its nine merged-main checks passed. The protected controller
now declares power, brightness and discovered saved scenes as supported
controller v1 capabilities, executes them as one journaled write each through the
single worker, treats power and brightness as overrides until the next explicit
mode command, accepts scenes only in Free, and lists scene names only in the
`nanoleaf.integration/1.0` snapshot. Source tests with fake devices only; the
installed wall is hub #155.

This companion extends the hub's exact-shape `validateIntegrationSnapshot` to
accept the optional `scenes` list, re-pins `nanoleaf-source.json` and
`compatibility-nanoleaf-source.json` to `8062849` with fresh file hashes, updates
the check script's receipt literal, and records the rerun of the bounded
cross-device compatibility suite (12 scenarios passed) against Hub `36090dd8fa4ec2f7f2fd36145c4b857a940d4474`,
Pixoo `28f4875` and Nanoleaf `8062849` in `docs/cross-device-compatibility.md`.
The receipt is kept with the companion PR. Nanoleaf #64 joins the reference-only
direct reads of the backlog refresh.

Refreshed all three backlogs, native dependencies and the paginated history at
2026-09-22T15:55Z: 93 primary open issues, 12 guides, nine viewers, 52 roadmap nodes,
123 merged PRs. N64 moves from open coverage, the general-controls timeline node
and the parallel units to a completed reference in the controls guide; the
Nanoleaf controls row now runs #153 to #155, and the controls next step no longer
waits on a native prerequisite. Architecture diagrams, ownership, transports and
physical writers are unchanged: the Nanoleaf worker remains the sole light
writer and the controller route and extension version are the same, so no viewer
is re-rendered.

Generation, nine maintenance tests and the browser/print checks pass; HTML
SHA-256 `ddc0d2896ffcef8b70538fbf46f43bae82b7f1422bf01bafd326ab80445d61ea`. This is a mixed change with files outside
`docs/work-guide/`, so all configured CI jobs apply. Public guide publication
and live verification remain separate and were not requested.

## September 22, 2026: General-control definition closeout

Hub PR #156 merged as `0ba711d8f01eb35574ca449c89e537b69fbb5b18`, identical
to reviewed head `f918779`. Both independent Standards and Specification
reviews passed with recorded P3 dispositions, and all six PR and all six
merged-main jobs succeeded. Hub #31 is closed as completed with its ten
planning criteria checked and its closing record posted.

This follow-up refreshes the three backlogs, native dependencies and the
paginated history at 2026-09-22T06:07Z, retains #31 as a completed reference,
removes it from open coverage and the remaining-work map, and rewrites the
overview, controls and desktop-control next steps so they no longer wait on
the definition. Hub #151 and Nanoleaf #64 have no open native prerequisites
and appear as parallel candidates; Pixoo #67 is listed as a non-blocking
companion; #153, #154 and #155 remain blocked by their listed prerequisites. There are 94 primary open issues,
12 guides, nine viewers, 52 roadmap nodes and 119 merged PRs in this snapshot.
Architecture diagrams, ownership, transports and physical writers are unchanged.

Generation, nine maintenance tests, browser/print checks and generated-output
consistency pass; HTML SHA-256 `0fafa2b15ca5ee830f90e8855d96c865e796fbda5fa6d85c35be1713e395b385`.
This follow-up changes only `docs/work-guide/**`; the unchanged workflow path
filters intentionally omit hosted checks and require the SDLC exception
receipt, recorded on the PR. No product behavior or OpenSpec delta. Public
guide publication and live verification remain separate and were not requested.

## September 22, 2026: General-control definition and concurrent closures

Hub #31's general-control definition was accepted in a grouped question round
and recorded in ADR 0005, with pointers in architecture, roadmap, desktop
controls and the README. The tracker now holds the bounded issues: Hub #151
(Pixoo controls), #152 (hub MCP media tools), #153 (Nanoleaf controls), #154
and #155 (hardware acceptance), Nanoleaf #64 (native capabilities) and Pixoo
#67 (playlist names), with native blocked-by links and refined notes on #67
and #56. Hub #31 stays open and in progress until this documentation PR merges
and its merged-revision CI is read back; a follow-up refresh records closure.

The same snapshot records three concurrent closures made by other sessions
today: Hub #32 (Codex-first milestone, completed on its reconciled dependency
table), Nanoleaf #55 (installed Linux runtime, completed on existing evidence)
and Hub #43 (architecture record, completed on its earlier PRs #84 and #98).
Their guide rows now read as completed, the shared-codex and hosting next steps
no longer point at them, and Hub #31, #32 and #43 join the direct acceptance
reads. The controls guide gains rows for the new issues; #151 and Nanoleaf #64
are listed as parallel candidates and are withheld until #31 closes.

Refreshed all three backlogs and native dependencies at
2026-09-22T05:45Z: 95 primary open issues, 12 guides, nine viewers, 52 roadmap
nodes. Architecture diagrams, history inputs, ownership, transports and
physical writers are unchanged. Generation, nine maintenance tests and the
browser/print checks pass; HTML SHA-256 `75575f090d6d5740d7408fcfb00e607de9d58606301d0c3ba9b0ec1ec9d6dea9`.
This is a mixed change with documentation outside `docs/work-guide/`, so all
configured CI jobs apply. Public publication and live verification remain
separate and were not requested.

## September 22, 2026: Nanoleaf device-aware state foundation

Nanoleaf #41 delivered the storage and geometry shape that the Lines and
Light Panels sequence builds on. The private configuration now registers each
device by id, kind, address and token reference, with the original Lines device
keeping the #28 controller identity `wall`. Placements, comets, Line
preferences, display cache, map settings, pending edits, Locate, mode metadata
and the saved scene are keyed by device, with uniqueness on device plus slot
and device plus element. Existing Linux state upgrades in place inside the
existing initialization, guarded and idempotent; a committed pre-change fixture
proves that tasks, epochs, preferences, the active comet, pending edits and
controller history survive. The layout file holds one entry per device with
each element's id, number and zones; legacy files still load. ADR 0009 and the
`device-state` specification record the decisions.

Nanoleaf PR #65 merged as `773d3ca7d97a1fb585baba8e3d9c19c197f337c4` after independent Standards and
Specification reviews and all nine PR checks passed; all merged-main checks
passed before #41 closed as completed. This is source-only: no installation,
hook, service or light change, and the worker still renders the original
device. #42 (runtime worker), #43 (NL22 rendering) and #46 (installed
acceptance) keep their own scope; #42 keeps its blocked label until its owner
releases it.

This entry refreshes the three backlogs and repository history, retains #41 as
a closed reference with comment links only (its delivery-claim comment names a
local worktree path), records it as completed in the Lines + Light Panels guide,
moves the guide's next step and the reviewed parallel unit to #42, and corrects
the worker row to the Linux runtime. The refresh also picked up new Hub #158
(iPhone Apple Music sources), which joins the controls and music guide and the
Apple Music roadmap node. The blocker regression now uses Pixoo #61 as its
open candidate. Ownership, transports, physical writers and the pinned
architecture viewers do not change, so no diagram is redrawn. Guide generation,
nine maintenance tests, the browser check and generated-output consistency
pass; HTML SHA-256:
`d36be03d25dacf308e9a914b5f1093687aaf43e8a4a84cab1dc7bad99b6e57fd`.
Public publication and live verification are separate and are not claimed here.

## September 22, 2026: Guide clarity source closeout

Hub PR #149 merged as `56e5667342cd446a229a4234dadf13fe3d07b0a2`.
Final independent Standards and Specification reviews found no remaining
findings. Nine maintenance tests and the six-width browser/PDF suite passed.
The merged guide matches the reviewed head exactly. All 18 changed paths were
under `docs/work-guide/`; both unchanged workflow filters explain the zero
PR and merged-revision runs, checks and commit statuses. No protection or
required check was bypassed.

Issue #148 is closed as completed for its source acceptance, with its workflow
label cleared. This follow-up refreshes the three backlogs, retains #148 as a
completed reference and removes it from open coverage and the remaining-work
map. The development guide now points to the next separately scoped design
choice. Public publication and live verification follow this reviewed merged
snapshot; they are not inferred from the Hub merge. No architecture or runtime
behavior changes. Generation, nine maintenance checks, browser/PDF checks and
output consistency are recorded with this candidate.

## September 22, 2026: Story status and actionable guide paths

Hub #148 makes issue status visible on every issue link, with text and symbols
for open, active, review, blocked, completed and other closed work. Completion
uses the saved GitHub closure reason. Blocked labels and open native prerequisites
remain visible even when an issue is in progress or review.

All twelve guides now start with their outcome and next action. Closed rows and
long evidence notes are expandable; search and print reveal them and restore the
prior state. The overview separates delivered work, Hub #32 milestone review,
and selected independent units. Parallel candidates are withheld when their
saved status is blocked, deferred, active or closed. Dependency data must be
complete. The roadmap starts folded and shows order without claiming readiness. Review caught its old ready marker on blocked input qualification; a regression now guards that contradiction. Routing and architecture are unchanged.
The desktop-control prose also follows the current Big B dictation / separate
Big A Enter defaults recorded in its owning issues.

The coordinator refreshed all three backlogs and reconciled 92 open issues,
including this maintenance story. Nine maintenance regressions and browser
checks passed at six widths from 320 to 1440 px, including keyboard status links,
search, evidence disclosures, navigation, viewers and real PDF restoration.
The status-link regression failed before the change because completed links had
no visible completion state. The exact HTML hash and review/CI receipts belong
to the source PR. This guide-only change has no product behavior or contract
delta and therefore needs no product OpenSpec change. The guide UI approval
exemption applies; independent reviews and the guide-only CI evidence remain
required. The user requested both repository delivery and public publication.
Public publication follows the verified merged source and is not claimed here.

## September 22, 2026: Pixoo installed monitoring acceptance

The owner installed Hub 0.2.0 / agent-state 2.0.0 from source `013b829` while
retaining the shared owner and private store. The actual Desktop/Ubuntu WSL
sequence passed active, idle, next active and automatic Pixoo notice clearing.
The owner confirmed both readable rows and the amber T on the physical Pixoo.
Explicit notice dismissal and active-playback Monitor/Media pause/resume checks
passed. Monitor is the selected final mode. Precise optical timing, firmware
variants and multi-client coverage are not claimed.

Pixoo PR #66 merged as `c81bc31c59068e00bf9d15a81577863ba9446931`,
recording dated evidence and restart/disconnection instructions. Both independent
reviews and all five PR plus all five merged-main checks passed. Issue #34 is
closed for the reduced installed scope. This refresh retains it as a completed
reference and removes it from open-work coverage.
The guide coordinator owns this companion; public publication remains separate.
The best-effort status policy can still misselect an unseen delayed start.
Task reset and reliable history remain separate features.

## September 22, 2026: Hub #9 source delivery closeout

PR #136 merged as `4f90164519167da3d7952d81a7a6211602ef28d5`, with the
reviewed tree preserved. Both final independent reviews and all six PR checks
passed. All six merged-main checks passed in Checks run 35681040338 and Work
guide run 35681040292 before #9 closed. All five reduced acceptance criteria are
checked; the seven-task OpenSpec plan is archived with no product specification
deltas. Twelve compatibility scenarios passed using synthetic metadata, real
consumer code and fake physical boundaries. The delivered #30 report supplies
the separate performance input at its own recorded revisions.

The #9 coordinator owns this linked guide-only follow-up. Refreshed paginated
backlog/history inputs, retained #9 as a closed direct reference, removed it
from remaining-work coverage, and updated the shared-monitoring row. Architecture
ownership and command flows are unchanged; viewer sources/receipts remain intact.
Generation, five maintenance tests, browser/print and output consistency results
are recorded with this candidate. The guide-only CI exception is assessed from
the full changed-file list and both workflow triggers.

No installation, real client or physical acceptance is claimed. The public guide
still records source `260707019b7ff83d57e31d91ae1e1582c3734589`; publication and
live website verification remain outside this source delivery.

## September 22, 2026: Hub #9 final source compatibility candidate

The #9 coordinator verified #30 closure and PR #135 merge `8411413`, and
linked its final acceptance report without repeating measurements. Reconciled
the concurrent main changes and refreshed the complete backlog. The guide keeps
#9 separate from delivered performance qualification and records source review
in progress. The new compatibility table preserves the distinct Nanoleaf/runtime
pins and installed/physical boundaries. Existing diagram ownership and command
flows are unchanged, so no viewer source or receipt changes apply.

Guide generation, five maintenance tests, browser/print and output consistency
checks passed for this final candidate. Public publication and live verification remain
outside this source delivery. Source merge and issue closure will be reconciled
in a linked guide-only follow-up after their authoritative readback.

## September 22, 2026: Hub #30 qualification closeout

PR #135 merged as `8411413fa43329dba6e25acc4cb715ffbba7887f` after both
independent reviews and all six PR jobs passed. All six merged-main jobs passed
in Checks run 35679809596 and Work guide run 35679809755 before #30 closed.
All seven current acceptance criteria are checked; historical criteria and failed
receipts remain unchanged. The committed receipt measures 487 synthetic hooks,
with hook p95 58/78 ms for one/ten tasks, consumer receipt p95 below one second,
and 151 MiB peak Hub RSS. Preparation, every scenario and cleanup passed.

Refreshed paginated history and backlog inputs, retained closed #30 as a direct
reference, removed it from remaining-work coverage and roadmap counts, and
updated the shared-monitor guide and recommendation. The coordinator owns this
linked guide-only follow-up. Generation, five maintenance tests, browser/print
checks and generated-output consistency are recorded with its candidate.
The architecture viewers retain their existing source pins and ownership.
The refresh also observes concurrent #63 closure after PR #140. It retains that
reference and removes it from open-work counts; its coordinator owns the
separate desktop-control closeout in PR #141.

This records source qualification with pinned real consumers and fake transports.
It makes no new installation, real-client or physical acceptance claim. Public
guide publication and live verification remain pending separate authorization.

## 2026-09-22 — Hub #30 standalone qualification candidate

The source command now has a retained passing run at Hub
`d9f5e7e1129f048f8caee046f8f6644e043ec6e2`: 400 warmed events,
487 hooks overall, hook p95 58/78 ms for one/ten tasks, each consumer receipt
p95 below one second and 151 MiB peak Hub RSS. All scenarios and cleanup passed.
The receipt preserves eight non-qualifying development attempts and all four
full runs. Review required confined preparation and positive reconnect evidence;
the final run covers both with unchanged targets. Targets and historical receipts were not relaxed or rewritten.

Updated shared-monitor qualification, sequencing and recommendation text, and
refreshed the complete backlog snapshot. Assigned concurrently published Hub
#137/#138/#139 to the shared-monitor guide without changing their scope or status. Preserved the concurrent Pixoo #34 and
Nanoleaf #30 guide updates from PRs #131/#134. Issue #30 remains open until
independent review, CI, merge and merged-source checks pass. Existing architecture
flows and ownership do not change, so diagram sources/receipts remain unchanged.
No application UI changed. Guide generation, maintenance and browser checks are
required on this candidate; results are recorded in the PR receipt.

The public edition still records source `260707019b7ff83d57e31d91ae1e1582c3734589`.
This source delivery does not publish the public guide or claim new installation,
real-client or physical acceptance.

## September 22, 2026: Hub #63 desktop-control documentation candidate

The delivery coordinator added `docs/desktop-controls.md` and discovery,
architecture and roadmap links for the accepted 8BitDo/Wispr/Codex direction.
The document distinguishes control profiles, button bindings and desk presets;
it preserves native controller modes, manual ownership and separate evidence
for source, installation, hardware/input, apps, transport and visible restoration.
No product behavior or wire-contract delta is introduced, so no new OpenSpec
capability is needed. Qualification and implementation remain in #64–#71.

The desktop-controls guide now links the canonical document and records #63's
in-progress state. PC-lighting PR #59 is merged and retains its separate scope.
The refreshed backlogs preserve the independent local shortcut path and the
Codex-first/general-control prerequisites for shared presets. The existing input
and preset diagrams already represent these accepted flows; no diagram content,
source pin or architecture-review date changes.

The complete refresh also found newly published #137–#139. Their existing
current-status, optional recovery and deferred-history scopes now have primary
coverage and roadmap nodes; this documentation task implements none of them.
Initial generation rejected their missing coverage before that reconciliation.

Node 24.21.0 setup and both workflow checks passed: 10 current specifications,
9 archived changes and 15 workflow tests. All 42 local Markdown links/anchors
passed. Guide generation, five maintenance tests and six-width browser/print
checks passed with 96 primary open issues, 12 guides and nine unchanged diagrams.
The public landing-page read returned HTTP 200 with the older hash below.
The issue remains open until independent Standards/Specification reviews, all
six applicable PR checks, guarded merge and merged-main checks pass. A linked guide follow-up will reconcile closure and
newly verified history. Public publication remains separate; the public README
still identifies Hub source `260707019b7ff83d57e31d91ae1e1582c3734589` and guide
hash `4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e`.

## September 22, 2026: Pixoo #34 reduced installed scope

The owner selected one Codex Desktop path through Ubuntu WSL, a short Pixoo
working/completed-task check, notice clearing/dismissal and basic Monitor/Media
behavior. CLI/Claude qualification, migration, extended failure matrices and a
shared-frontend trial are no longer #34 completion requirements. The issue body
records that decision; older entries below describe the superseded scope.

Source PR #65 and all five merged-main checks are complete. Installation and
real-task/display observations remain pending. The Nanoleaf task is still
configuring the existing shared host, so the Pixoo coordinator is preparing its
consumer without concurrently changing that installation. No device commands
or personal configuration writes are claimed here.

This guide also preserves the separately merged Hub #30 scope revision from
PR #133. Hub #30 closes on standalone source qualification, independently of
live installation and physical timing. Public publication remains separate.

## September 22, 2026: Hub #30 personal-project scope revision

The owner approved standalone Linux/WSL qualification for everyday Codex
monitoring. The saved Hub #30 body now requires real Pixoo/Nanoleaf consumers
with synthetic input, disposable state and fake device transports; hook-return
and consumer-receipt timing; normal/concurrent use; a short overload burst; and
ordinary reconnect, unavailable-consumer and host-restart checks. One command
and a concise report replace the broad multi-host qualification programme.

Embedded-host hardening in Pixoo #61 is no longer a prerequisite for implementing
or closing Hub #30. Existing #61 acceptance remains unchanged. Historical
percentile ceilings are diagnostic comparisons for the revised #30; practical
standalone targets must be defined before qualification runs. The 3,000 ms hard
hook deadline, 256 MiB service RSS ceiling, bounded resources, confinement,
cleanup and single-owner protections remain required. Historical budgets and
failed receipts remain unchanged and do not become passing evidence.

The coordinating writer updated only Hub #30's body, preserving its title,
labels and open state, then refreshed the guide backlogs and shared-Codex
sequence. This is a planning change with no product behavior delta, so no new
OpenSpec change is needed. Architecture ownership and command flows are
unchanged; diagram artifacts and their source-review dates need no update.
Implementation, qualification, installation and physical acceptance are not
claimed. Public publication remains outside this revision.

Guide generation, all five maintenance tests, six-width browser checks and print
expansion/restoration passed. The guide contains 94 primary open issues, 12
guides and nine diagrams. The initial refresh detected Hub #6 closing during
this task; its separately merged guide PR #132 was incorporated before these
checks. No diagram artifacts or product tests were changed.

## September 21, 2026: Hub #6 source completion

[PR #127](https://github.com/jimmie-potts/agent-device-hub/pull/127) merged as
`5724f51168ff4dec7fde0aa8644bb4e809547af0`. The user approved the source UI;
independent Standards and Specification reviews accepted the final comparison
with no remaining P0-P2 findings. All six PR checks and all six merged-main
checks passed before issue #6 closed. The known P3 navigation collision for
component aliases `activity` and `connections` remains a frontend maintenance
follow-up documented in PR #127.

The delivery coordinator owns this guide companion. It refreshes the three
backlogs and paginated histories, removes completed #6 from primary coverage
and the remaining-work roadmap, and records the delivered BUNNY dashboard.
The shared-system diagram now distinguishes delivered dashboard/MCP clients
from planned desk presets. Hub source receipts pin the merged revision and
include the dashboard README. The guide covers 94 primary open issues,
12 guides, nine diagrams and 102 merged PRs.

Generation, five maintenance tests, six-width browser checks and print checks
passed. All nine diagram deliveries passed 9/9 artifact checks. The changed
shared-system viewer passed Archify browser checks at all four required desktop
sizes, with light/dark endpoint captures. Its desktop, mobile and print renders
were inspected. The other viewers retain their documented baseline limitations.
Guide SHA-256: `6a211405fd20b7da814e5a826161f0076d36710f7e18a49e6892e1656dcb50f6`.
This guide-only follow-up uses the SDLC path-filter exception with local evidence
and independent reviews; it adds no product behavior or OpenSpec capability.

Personal installation, actual-client qualification and physical acceptance remain
separate. The public guide remains the earlier
`4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e` edition;
this source delivery does not authorize public publication.

## September 21, 2026: Hub #13 source completion

[PR #126](https://github.com/jimmie-potts/agent-device-hub/pull/126) merged as
`ee1eac1608d1cff72293a6627da4685f951f241f`. Independent Standards and
Specification reviews approved the source candidate after the packaging
correction. All five PR checks and all five merged-main checks passed before
#13 closed. The hub suite passed 43 tests, including 14 host MCP tests; a fresh
offline archive consumer passed 42 tests. The eight-task OpenSpec change is
synchronized and archived.

This follow-up records completed source delivery, refreshes the three backlogs
and paginated histories, and removes #13 from open-issue coverage and the
remaining-work roadmap. The coordinating writer owns this guide companion to
PR #126. The existing diagrams retain the same clients, registered routing,
shared module and controller owners; no diagram or source-review date changes
are needed. Installed Codex/Claude, physical acceptance and public publication
remain separate. Pixoo catalog/player handlers remain in its application.

Guide generation, five maintenance tests, browser/print checks and identical
regeneration passed. This change contains only guide files and uses the
verified guide-only CI exception. It does not publish the public website.

## September 21, 2026: Hub #13 standalone MCP candidate

Updated shared-hosting guidance and the backlog snapshot for the opt-in MCP candidate. The host delegates qualified session commands and configured controller operations to existing owners. Source protocol checks cover synthetic Codex/Claude profiles, authorization, replay, native settings, stale evidence and disconnect. Installed clients, devices and public guide publication remain separate.

The existing shared-system diagram still describes the same clients, registered routing, shared module and controller ownership. No component, connection or ownership changes; its planned client group continues to include the undelivered dashboard and desk presets. Architecture viewers and source-review dates are unchanged. This entry records candidate work, not a merge or issue closure. Guide generation, all five maintenance checks and the browser checker passed with no browser errors.

# Guide maintenance history

## September 21, 2026: Hub #8 source completion

[PR #129](https://github.com/jimmie-potts/agent-device-hub/pull/129) merged as
`f6bee907e06177c6dc8abde0075d73cc391784e9` after both independent reviews and
all five PR jobs passed. All five merged-main jobs passed before issue #8 was
closed as completed. This follow-up records source acceptance, refreshes all
three backlogs and paginated histories, removes #8 from primary open coverage
and the remaining-work roadmap, and pins the setup/migration diagram to the
merged source. The Hub #8 delivery coordinator owns this completion companion.

The guide covers 95 primary open issues, 12 guides, nine diagrams and
100 merged PRs. Reversible setup, credential ownership, explicit Nanoleaf
selection and fenced migration are source-delivered. Personal installation,
actual-client qualification, integrated performance and physical acceptance
remain separate. This follow-up changes only guide files and adds no product
behavior or OpenSpec capability.

Generation, five maintenance tests and guide browser/print checks passed.
All nine diagram deliveries passed 9/9 artifact checks. The changed migration
viewer retains its known vertical overflow; no standalone containment repair
is claimed. Desktop/mobile/print captures were inspected.
Guide SHA-256: `ca8c9574de6ac79a480d232ecbb0b162db56aea5cd4aa8e71916d5326359d53d`.

The public landing page remains the earlier
`4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e` edition.
Public copying, deployment and full live-site verification remain pending
separate publication authority. No personal installation or device operation
was performed. The companion PR records exact guide-only filtering evidence.

## September 21, 2026: Hub #8 setup candidate

The Hub #8 delivery coordinator updated the shared-host guide and migration
sequence for the owner-selected Linux/WSL source scope. The candidate adds
reversible setup, private receipt ownership, verified credential revocation,
and explicit Nanoleaf preflight/selection while host writes remain fenced.
The source fixtures exercise real pinned Pixoo/Nanoleaf code with disposable
state and no physical worker. Installation and actual-client qualification
remain pending. No personal settings, live state or devices were changed.

Refreshed all three backlogs and retained primary coverage of
96 open issues across 12 guides and nine diagrams.
Generation, five maintenance tests and guide browser/print checks passed.
All nine Archify deliveries passed 9/9 artifact checks. The changed sequence
was inspected in light/dark desktop renders; the separate standalone browser
check still fails its known vertical overflow requirement. No layout repair
or first-screen containment pass is claimed. The guide's scrolling/zooming
presentation remains usable. HTML SHA-256: `3238b53989d418b35c0a14ce06daeecda1ffbd37671c820b33e73920c0bffb38`.

The public landing page still serves
`4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e`.
It differs from this candidate. Public publication and live verification of a
new edition remain pending separate authority. Source merge and saved issue
completion facts will be reconciled in a linked follow-up after verification.

The candidate was reconciled with merged MCP PR #126 and its guide follow-up #128. The refreshed tracker
shows #13 closed, so its primary coverage and roadmap entry were removed; its
source behavior and shared host/package checks are preserved.

## September 21, 2026: Hub #5 source completion

[PR #121](https://github.com/jimmie-potts/agent-device-hub/pull/121) merged as
`2c3bb4117bab0f845a95048b4ce72a49e915cfdc` after both independent reviews and
all five PR checks passed. All five merged-main checks passed before #5 closed.
This follow-up records that source acceptance, refreshes all three backlogs and
paginated histories, removes #5 from open-issue coverage and the remaining-work
roadmap, and pins the ownership/migration diagrams to the merged source.

The guide now covers 97 primary open issues, 12 guides, nine diagrams and 96
merged PRs. Source delivery includes bounded controller integration and
supervised migration/rollback. Installed migration remains #8, full performance
qualification remains #30 and budget/memory improvements remain #123. This
follow-up changes only guide files and adds no product behavior or new OpenSpec
capability. The coordinator is the Hub #5 delivery task; this is its completion
companion to PR #121.

Generation, five maintenance tests, browser/print checks and identical
regeneration passed. All nine diagram deliveries passed 9/9 artifact checks.
Guide SHA-256: `2b55a737248f162e9c9da1ab13d53552657359a73766065ec9b131ccc8b5887a`.
Changed desktop/mobile/print renders were inspected. The shared-system viewer
passed standalone containment; the migration viewer retains its documented
vertical overflow, so that separate first-screen check failed. No viewer layout
repair is claimed.

The public landing page was read successfully and still serves SHA-256
`4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e`, which differs
from this guide. Public copying, deployment and full live-site verification are
pending separate publication authority. No installation or device operation was
performed. The PR records the exact guide-only CI filtering and merge evidence.

## September 21, 2026: Hub #5 integration and migration candidate

PR #121 now includes the delivered Pixoo monitor extension, Linux Nanoleaf
settings adapter and supervised migration with fenced activation, durable route
recovery and rollback after new writes. Disposable owning-service checks passed
against pinned source. This is source evidence; installed migration remains #8,
full qualification remains #30 and budget/memory follow-up remains #123.

Final review tightened readiness to a live supervised Pixoo process and its
selected configuration; the missing-facade regression and real simulator
cutover passed. The host README receipt now pins `2b80b96`.

Updated shared-hosting text, the ownership and migration diagrams, and pinned
Hub source receipts at `f606c09`. Refreshed all three repository inventories.
Generation, five maintenance tests and guide browser/print checks passed with
98 primary open issues, 12 guides and nine diagrams. All nine diagrams passed
9/9 deterministic artifact checks. Guide SHA-256 is
`a34a2db21bc565739fd793352ae66547b32bfd2f7740023064ed3dd57e1fa35d`.

Inspected the changed diagrams at desktop/mobile sizes and in print. Archify's
standalone shared-system browser check passed all four desktop sizes. The
migration viewer retains the documented vertical-overflow limitation, with no
horizontal overflow and readable labels; its automated first-screen check
failed. No overflow repair or viewer redesign is claimed. The guide's print
containment and interaction checks passed. Public publication and live-site
verification remain pending. A hosted package check exposed a readiness/shutdown race in the synthetic
consumer-proof child. Its handler now initializes before its ready line. This
test-fixture repair changes no represented guide fact or diagram.
Post-merge tracker/history reconciliation follows
only after source review, CI and merge are verified.

## September 21, 2026: Owner-approved service memory budget

The owner doubled the Linux/WSL service RSS constraint from 128 to 256 MiB.
[Hub #123](https://github.com/jimmie-potts/agent-device-hub/issues/123) now tracks
budget re-evaluation and measured memory improvements as non-blocking backlog
work. The budget artifact, baseline explanation and host documentation record
the decision; all historical failed receipts remain unchanged. A fresh 9,000-sample
API run passed the revised memory check with 164.64 MiB peak RSS. This does
not establish full integrated qualification or complete Hub #5.

Refreshed all backlog inputs, added #123 to the shared-Codex guide and roadmap,
and retained the merged Pixoo #33 source/diagram updates. The budget revision
changes no device ownership or command flow, so it needs no further diagram
changes. Guide generation, maintenance/browser checks and source review are
recorded in PR #121. Public publication remains separate and pending.

## September 21, 2026: Initial Hub #5 Linux host candidate

The owner selected Linux in WSL and excluded native Windows runtime work.
Issue #5 now records that decision and is in progress. The original five
prerequisites and Nanoleaf #49 were closed; Pixoo #33 was still open at this initial checkpoint. The active
`gh-5-hub-host` candidate has not merged or completed migration acceptance.

Refreshed all three backlog inventories and updated the shared-hosting row.
The existing diagrams still correctly mark standalone hosting as planned, so
no topology or architecture-source receipt changes are made. Generated guide
validation is recorded in the candidate PR. Installation, devices, public
publication and live-site verification are outside this source-only delivery.

The same snapshot records Hub #49 closed. Its placeholder is removed from open guide and timeline coverage; this is a tracker reconciliation, not evidence that a connector was implemented. The regenerated guide covers 99 open issues and passed five maintenance tests and the browser check.

## 2026-09-21 UTC: Pixoo #33 monitor controls delivered

[Pixoo PR #64](https://github.com/jimmie-potts/divoom-app-upgrade/pull/64)
merged as `28f4875b7a0f0e57ca6f25d9971e125e927a5503`. Its tree matches the
reviewed candidate `dcadf88f6b29f1944c8df811af7e4592197dd2ee`. All five PR jobs
and all five merged-main jobs passed. Issue #33 is closed with all 13 criteria
checked. Local Node 24 validation passed 587 application tests, 64 browser
checks and 10 workflow fixtures, with 17 current specifications and 18 archives.

The Monitor panel adds owner-backed labels/notices, project/session filters,
exact RGB preview and explicit Monitor/Media activation. The existing Player
and serialized adapter remain the sole writer. The finite protected integration
extension preserves shared controller v1 and existing MCP tools. Restart and
screen-on remain passive. Source review required three rounds; cancellation,
stale-read handling, ambiguous-request retention and a test locator were
corrected with regression evidence. PR #64 records the resolved findings and
superseded browser failure.

This companion refreshes authoritative backlogs/history, removes P33 from
remaining-work coverage and the roadmap, updates the shared-Codex narrative,
and shows explicit mode/view commands in the lifecycle diagram. All 13 Pixoo
source hashes and eight cached copies match the immutable merged source.
Concurrent Hub PR #120 central BUNNY planning, its Hub #49 closure and PR #122
public-verification maintenance remain
intact. The refresh also observes Hub #80 closure after its independently owned
verification of the existing public edition; it removes H80 from remaining-work
coverage without claiming this newer guide is published. An initial refresh
crossed an issue closure and failed its open-state assertion; a complete fresh
read replaced the partial candidate. Historical source-review receipts keep
their original limitations.
This documentation-only change introduces no product specification delta.

Generation, five maintenance tests, browser/print checks, diagram layout and
visual inspection are recorded against the companion's final revision in its
PR. Independent guide reviews and guarded merge remain required. The Pixoo #33
coordinator owns [Hub companion #119](https://github.com/jimmie-potts/agent-device-hub/pull/119).
Installed-client and physical acceptance remain Pixoo #34. No device operation
or installation occurred. Public publication is outside this delivery; the
public landing page still matches the previously published source `950f7f6`
and SHA-256 `0f37a2db680f075952c3e055892b5efef4d5d6c366cf20c0f0e9e04aa706f55c`.

## 2026-09-21 UTC: Public guide verification and publication preparation

The user authorized publication of the central BUNNY UI planning from
[Hub PR #120](https://github.com/jimmie-potts/agent-device-hub/pull/120).
This Hub follow-up coordinates the source snapshot and its separate public
publication PR. It preserves the central component UI requirements and adds no
product behavior or OpenSpec delta.

The remaining acceptance check in
[#80](https://github.com/jimmie-potts/agent-device-hub/issues/80) is now verified.
Unauthenticated requests to the existing landing page and all eight viewers
returned HTTP 200. All nine served hashes matched Hub source
`950f7f62d502bc1d55d0f95872a4a10c08d4a27a` and public revision
`d00a99d4f24b240094283d573d2b600798e48372`. The three Pages jobs, twelve source
jobs and guide/browser job were read back as successful. Public PR #3 records
the original reviews and publication. Issue #80 is closed as completed, with
its old evidence retained and the successful live verification appended.

The complete backlog refresh also observed Pixoo #33 closing after source
PR #64 merged. It leaves remaining-work coverage and stays a completed
reference. Its dedicated architecture and history synchronization remains with
the Pixoo coordinator in [Hub PR #119](https://github.com/jimmie-potts/agent-device-hub/pull/119).
This publication does not adopt that unmerged candidate. No architecture
topology or source pins change here; all nine viewers and their separate review
dates are retained. The dated history snapshot is unchanged.

Generation, five maintenance tests and browser checks at
1440/1000/900/768/390/320 passed, including navigation, search, viewer links,
exact issue coverage and print expansion/restoration. The guide contains
97 primary open issues, 126 linked issues, 12 guides, nine diagrams and
49 roadmap nodes. HTML SHA-256:
`4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e`.
The source and public PRs retain the fixed reviews, CI-filter evidence, exact
published revisions, deployment result and every served-file hash. The public
copy must come from the merged source revision; publication and verification
remain separate from this source preparation.

## 2026-09-21 UTC: Central BUNNY component UI requirements

This Hub planning delivery coordinates the user-authorized updates to
[#6](https://github.com/jimmie-potts/agent-device-hub/issues/6) and
[#31](https://github.com/jimmie-potts/agent-device-hub/issues/31).
Both saved bodies were read back exactly; their titles, open state and labels
were preserved. Five new frontend criteria and four later planning criteria
require consistent navigation and component status, settings and supported
controls, based on the approved Nanoleaf UI. A third synthetic component
verifies the reusable pattern without adding production hardware prerequisites.

Architecture and roadmap text, the shared Codex guide and the controls/music
guide now describe the same central application and delivery phases.
Advanced editors remain linked initially, and general controls stay deferred
behind #32. This update delivers planning records and guide source; it adds no
dashboard implementation, device API or installation.

The complete backlog refresh also observed the independent closure of Hub #49.
It is retained as a closed planning reference, removed from remaining-work
coverage and the roadmap, and is not described as delivered connector software.
The refresh preserves concurrent Hub #5 and Pixoo #33 delivery status.
No device ownership or command flow changes, so the nine architecture viewers,
their source-review dates and history evidence remain unchanged.

Generation, five maintenance tests, browser checks at 1440/1000/900/768/390/320,
print expansion/restoration, navigation and exact issue coverage passed.
The generated guide contains 99 primary open issues, 126 linked issues,
12 guides, nine diagrams and 49 roadmap nodes. HTML SHA-256:
`028ec4c874181b51e3d8d38345ee09a39285963acc9e776db97a9c932ede194c`.
Candidate review, CI and merge evidence belong in the linked planning PR.

The public edition still serves the previously published revision
`950f7f62d502bc1d55d0f95872a4a10c08d4a27a`; its landing-page hash matches the
public README. Public publication is outside this planning update's finish line.

## 2026-09-21 UTC: Nanoleaf #49 integration extension source

[Nanoleaf PR #63](https://github.com/jimmie-potts/codex-nanoleaf/pull/63)
merged as `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`, with the exact tree
of reviewed head `8e5cb47c741ca161849ce1391a39c12f15fdac02`. All nine PR jobs
passed. Separate Standards and Specification reviews found no actionable
findings. The intermediate missing-pending-values finding was reproduced,
corrected and independently reassessed. Local checks passed 231 Python tests,
including 15 extension tests, 26 Python/TypeScript request fixtures and four
receipt mappings, plus browser and workflow checks with 10 workflow fixtures.
All nine merged-main jobs also passed in run `35546463309`; issue #49 is closed with every acceptance criterion checked and source-only boundaries retained.

The Nanoleaf-owned `nanoleaf.integration/1.0` extension adds pure private
projections and protected revisioned configuration edits through existing wall
operations and the sole worker. Shared controller v1 stays unchanged.
Configuration receipts are separate from unknown physical outcomes. Native
Linux and retained Windows keep private databases. No frontend, installation,
device operation or public publication is included.

Refreshed backlog and paginated history inputs record actual source status.
Concurrent Hub PR #117 merged as `25715f1536dc17d9bd8fa7a0e024ac449acfd5d0`.
This candidate preserves its Pixoo renderer narrative, updated architecture
viewer and source pins, then regenerates from fresh inputs.
Diagram topology and dated review pins remain unchanged: the extension uses the
already represented native controller and existing writer, and does not alter
the mode-only MCP surface. The new versioned operation details are linked to
[the merged API guide](https://github.com/jimmie-potts/codex-nanoleaf/blob/f12ac6653a9f3267fa9ef62a2d6667072183d8b3/docs/integration-api.md).
No new architecture ownership, provider contract, writer or rendering flow is
claimed by this guide synchronization. Generation, maintenance and browser
validation receipts are retained in the companion PR. Public publication and
live verification are outside this delivery.


## 2026-09-21 UTC: Pixoo #32 renderer source delivered

[Pixoo PR #63](https://github.com/jimmie-potts/divoom-app-upgrade/pull/63)
merged as `9bd99c1b2ec1759cc70eedd5644e585627d3fd25`. Its tree matches the
independently reviewed candidate. All five PR jobs and all five merged-main
jobs passed. Issue #32 is closed as completed. The first current-head Windows
PR attempt timed out in an existing diagnostics test; one rerun passed without
code changes.

The renderer supplies stable attention-first pages, exact 64×64 RGB888 preview
pixels and bounded generation publication. Local validation passed 564 tests,
56 browser checks and 10 workflow fixtures, with 16 current specifications and
17 archives. Synthetic previews were inspected at native and enlarged scales.
Pixoo #33 owns the monitor panel and device writer integration; #34 owns
installed acceptance. No display commands or installation were performed.

This companion refreshes source pins, history and backlog evidence, removes P32
from remaining-work coverage and updates the shared-state diagram. The changed
viewer passed all four archify viewport checks and was visually inspected.
Guide validation and merge evidence belong in Hub PR #117. Public publication
is outside this task.

## 2026-09-20 UTC: Pixoo dashboard physical evidence

[Pixoo PR #62](https://github.com/jimmie-potts/divoom-app-upgrade/pull/62)
records four authorized dashboard runs after the source tooling merge in #59.
The selected method is complete RGB frames with a configurable 1000 ms minimum
submission interval. The owner confirmed readability. Recordings show row
clearing, overflow, coalesced bursts and a separately authorized successful
restart after cancellation left an in-flight picture applied. No automatic
retry or restoration of unknown original artwork is claimed. Firmware remains
unknown; sparse runs and uncalibrated cross-clock timing do not establish
sustained 1 Hz or universal device limits. Pixoo #30 is closed as completed after
PR #62 merged as
`671b8dda3c620fc7cefb48af112c49be0687063a`, with the same tree as reviewed
head `17b28a627091584eb08e1299a8ae6d634f8fe37e`. Both independent review axes
found no actionable findings. All five PR checks passed after one unchanged
Windows diagnostics test timed out and passed on rerun; all five merged-main
checks passed on their first attempt.

The shared Codex sequence retains #30 as a completed reference and removes it
from remaining-work coverage and the roadmap. It preserves #32, #33 and
#34 as separate renderer, integration and real-client acceptance work. No runtime
ownership or command flow changes, so architecture definitions and their review
pins remain unchanged. Backlog/history facts and generated output are refreshed
through the guide procedure. Concurrent Hub #115 Nanoleaf source/architecture
updates are preserved. Guide generation, five maintenance tests, generated-output
consistency and six-viewport/print browser checks passed. Public publication is
outside this delivery; no installation or additional device operation is included. This documentation-only
reconciliation requires no product specification delta.


## 2026-09-20 UTC: Nanoleaf #29 shared consumer source

[Nanoleaf PR #62](https://github.com/jimmie-potts/codex-nanoleaf/pull/62)
merged as `5375a3088522507c7f207c6e9c824454db1e1d5f`, with the same tree as
reviewed head `8deed074c1d214071f255f445dad95c181f56ed9`. All nine PR jobs
and all nine merged-main jobs passed. Issue #29 is closed as completed, with
status labels removed and its acceptance checklist read back.
Independent Standards and Specification R2 reviews found no unresolved findings.
Local checks passed 216 Python tests, browser checks and 10 workflow fixtures.
The 900-operation synthetic Linux measurement identifies source hashes and does
not claim integrated or physical performance acceptance.

The selected shared feed is authoritative while the existing Python worker keeps
sole light-write ownership. Stale sessions retain steady last colors, with no
automatic fallback. An evidenced new turn clears notices for Nanoleaf only.
Existing incompatible durable consumer policies need a supported migration before
installed cutover. Hub #8 and Nanoleaf #30 retain installed and physical acceptance.

Refreshed backlog and paginated history inputs record the actual merge and
closure. #29 remains a completed reference and leaves primary remaining work.
The shared-system diagram and lifecycle notes now describe the consumer source.
All 14 refreshed Nanoleaf source copies match the merged revision and SHA-256
receipts. Historical Hub/Pixoo source-cache gaps predate this refresh and are not
newly verified. All nine diagrams passed deterministic Archify checks. The changed
viewer passed four desktop viewport checks and light/dark visual inspection.
Generation, five maintenance tests and desktop/mobile/print checks passed for the
candidate. Public publication and live verification remain outside this delivery.

## 2026-09-20 UTC: Pixoo embedded-host performance deferral

[Pixoo PR #60](https://github.com/jimmie-potts/divoom-app-upgrade/pull/60)
merged as `3414847a6f80826fc6e2501aac98c3dd8fe71163`, with the same tree as
reviewed head `f34638c1dafac0e91b3cd85b0a60afdb97896006`. All five PR jobs
and all five merged-main jobs passed. Issue #31 is closed as completed. Local
validation passed 553 application tests, 54 browser tests and 10 workflow fixtures;
15 specifications and 16 archives validate. Both independent review axes passed.
The guide retains #31 as a completed reference and removes it from remaining work.


The owner moved Pixoo #31 performance measurement and numeric acceptance to
[Pixoo #61](https://github.com/jimmie-potts/divoom-app-upgrade/issues/61).
It follows #31 without blocking that feature or dependent feature work. The
frozen budgets and failed receipts remain unchanged; no performance acceptance
is claimed. Correctness, authentication, privacy, durability, bounded resources,
failure isolation and hard fail-open deadlines remain mandatory. Hub #30 keeps
integrated qualification and consumes the later embedded-host evidence.

Refreshed backlog inputs, primary coverage, shared Codex narrative and timeline
record the new story and remove the superseded performance merge blocker.
The companion also reconciles the delivered host boundary in the shared-system,
lifecycle and migration diagrams, with pinned source receipts. Standalone hosting,
installed cutover and device consumers remain pending. Concurrent Hub #113 already
records the #61 deferral and dashboard source merge; those newer inputs are preserved.
All nine diagrams passed deterministic Archify checks. The changed shared-system
and lifecycle viewers passed four desktop viewport checks and visual inspection.
The migration viewer retains its documented vertical-scroll limitation; no
first-screen containment pass is claimed for it. Guide generation, five maintenance
tests and desktop/mobile/print browser checks passed.

The public edition still serves SHA-256
`0f37a2db680f075952c3e055892b5efef4d5d6c366cf20c0f0e9e04aa706f55c` and lacks #61.
This documentation change needs no product OpenSpec delta. Public publication,
installation and physical acceptance are outside this source-only follow-up.

## 2026-09-20 UTC: Pixoo #37 source acceptance and guide reconciliation

[Pixoo PR #58](https://github.com/jimmie-potts/divoom-app-upgrade/pull/58)
merged as `e541412b201fa9a0bfa5c10f7108ca217536691e`, with the same tree as
reviewed candidate `00ad8f632222d0fd8e421bfc46ece300cab18685`. Independent
Standards and Specification reviews found no remaining blockers. All five PR
jobs and all five merged-main jobs passed. Issue #37 is closed as completed.
Local Node 24 checks passed 515 application tests, 239 controller compatibility
tests, 10 workflow fixtures and 52 browser tests. The compatibility total is a
subset of the application suite. Thirteen current specifications and fourteen
archives validate, including the synchronized `gh-37-hub-controller-api` change.

The candidate reconciles concurrent Hub PR #111 dashboard qualification and
PR #112 host performance-blocker entries before regeneration.

The complete backlog and paginated history refresh retain #37 as a completed
reference, remove it from primary remaining work and the roadmap, and leave
shared state hosting with #31. The guide records configured native identity,
scoped authentication, shared replay and writer ownership, bounded feeds and
media evidence across cancellation and recovery. Source delivery does not
establish installation, real hub-client operation or physical accuracy.

Pixoo architecture source pins and SHA-256 receipts now reference the merged
revision. The local-command diagram includes the optional native client;
playback notes describe the shared ledger and retained upload outcomes. Other
repository pins and diagram topology remain unchanged. All nine diagrams pass
Archify's nine deterministic checks. The two changed viewers retain exactly
the baseline viewport dimensions, including the documented vertical overflow;
these checks do not establish a first-screen containment pass. Guide generation,
maintenance tests, browser/mobile interactions and print checks are recorded
on Hub PR #110. No product specification delta applies to this guide-only work.
Public publication and live-site verification remain outside this source-only
request; the public copy has not been updated by this delivery.

## 2026-09-20 UTC: Pixoo #37 controller API candidate

The Pixoo #37 coordinator refreshed the complete three-repository backlog after
moving that issue to in progress. The shared-Codex guide identifies the native
controller API candidate and retains pending source acceptance. The refresh also
found Hub #103 closed after PR #104, so it is retained as a completed reference
and removed from remaining-work counts. No implementation, installation or
physical acceptance is inferred from these tracker changes.

The candidate keeps the accepted controller ownership and queue flow. Existing
architecture diagrams still describe that direction; their source pins and
viewer bytes are unchanged while source delivery remains pending. History keeps
its separate dated snapshot. No product specification delta applies to this
guide-only synchronization. Generation, maintenance and browser checks are
recorded on the companion PR. Public publication is outside this source-only
request and remains separate.

## 2026-09-20 UTC: Pixoo #31 host candidate

The Pixoo #31 delivery coordinator refreshed the authoritative issue and its five
closed prerequisites, verified the agent-state 1.0.0 release archive, and moved
Pixoo #31 to in progress. The host candidate preserves the simulator default and
existing explicit device mode, following the user's scope decision. Monitoring
has separate private storage and credentials, a selected embedded/remote source,
and an explicit quiesce/import boundary. It does not install hooks or operate
devices. Local Linux measurements exceeded fixed percentile budgets, so Pixoo
#31 remains open and blocked. Review, acceptance and source merge remain pending.

Affected guide sections: shared Codex integration, suggested next source work,
and refreshed backlog/status inputs. Paginated history reads also reconcile the
separately merged Atlas PR #104 and closed Hub #103. Ownership diagrams retain their existing
planned host/source separation; this unmerged candidate does not establish an
implemented-host label or new architecture ownership. Reconcile those source
pins and delivery facts after verified source merge. Public publication and live
verification are outside this source-only task. Validation receipts and the
linked source PR belong in this companion PR's delivery evidence.

## 2026-09-20 UTC: Complete PR #104's offline asset bundle

The first hosted run of the conflict-free candidate passed all four core jobs
but failed the reference asset receipt check. A fresh Git archive reproduced
the failure: the root `dist/` ignore rule had excluded 41 SchemaSpy theme CSS
and JavaScript files that were present in the local browser candidate. Added a
narrow exception in the reference directory and committed those assets. All
330 database report files now match the existing generation receipt exactly.
The receipt, upstream asset bytes and authored pages are unchanged.

The static document checks and full atlas/reference browser checks pass from a
fresh Git archive, covering 28 reading pages, 37 operations and 28 tables with
offline assets and no page errors. Guide facts, ownership, architecture and
generated guide bytes are unchanged, so the preceding merge reconciliation's
snapshot and checksum are retained. No new OpenSpec change is needed. Renewed
fixed-revision reviews and hosted CI are recorded on PR #104 before closing out
the requested conflict-resolution work.

## 2026-09-20 UTC: Resolve PR #104 against current main

The Hub coordinator resolved the six textual work-guide conflicts in
[PR #104](https://github.com/jimmie-potts/agent-device-hub/pull/104), combining
candidate `0a029966f82fe31958616be3241fb2e9b76c89de` with main
`1ea93eebc13ee818962053daa7cb690c5735c59a`. Retained both maintenance histories,
main's shared agent-state implementation, five-job Ubuntu CI, guide approval
policy and delivery closeout from PR #109. Reconciled the source inputs before
regenerating the HTML. Hub #103 has one primary guide assignment, one roadmap
node and one detailed documentation row.

The complete backlog refresh retains Hub #3 and #107 as completed references.
The guide contains 106 primary open issues, 125 linked issues, 12 guides,
49 roadmap nodes, 72 historical merges and nine architecture viewers. The
history, architecture viewers and source receipts match main. The BUNNY atlas
and API/database references are unchanged from the previous candidate and
retain their source pins. This conflict resolution changes no product behavior
or ownership and needs no new OpenSpec change or architecture redraw.

Node 24 workflow validation passed for six specifications, zero active changes
and five archives; all 15 workflow tests passed. Guide generation, all five
maintenance tests and browser checks passed at 320, 390, 768, 900, 1000 and
1440 pixels, including navigation, search, timeline, viewers and print. Atlas
and reference checks passed for 28 reading pages, 53 reference pages,
37 operations and 28 tables, including offline browser checks and all three
source-extraction tests. Guide SHA-256:
`ae940b35cc2dca468ecbb094bd4217ee7206773fba2796f60133432967b390aa`.
Screenshots and browser receipts remain outside Git.

The requested finish line is a conflict-free PR branch. Renewed independent
reviews and current-head hosted checks are recorded on PR #104. Main merge,
atlas UI approval and public publication remain separate from this update.

## 2026-09-20 UTC: Complete Hub #3 release and reconcile CI acceptance

The #3 coordinator completed source delivery after [PR #105](https://github.com/jimmie-potts/agent-device-hub/pull/105)
merged at `f550bcd6b7d3b7da0f34c90c622b343afe2b25fb`. Its tree matches the
independently reviewed candidate. Published the [agent-state 1.0.0 release](https://github.com/jimmie-potts/agent-device-hub/releases/tag/agent-state-v1.0.0)
with the reproducible archive, checksum, source receipt and final CI acceptance
receipt. Downloaded all four assets and verified their exact bytes. A fresh build
at the merged revision reproduces archive SHA-256
`ae589d311e282c3356579c85507a3aa973ab7990e06e062143aeb08d8d2dcc99`.
External consumers, 96 Node/process tests, 36 Python snapshot fixtures,
build/type checks and workflow checks passed.

The separately owned [PR #108](https://github.com/jimmie-potts/agent-device-hub/pull/108)
merged the owner-approved five-job Ubuntu matrix and package-index repair at
`ed5024e94da08009f313b08a0dd0e5a1af687a25`. Read every job and its executed
steps in [Checks](https://github.com/jimmie-potts/agent-device-hub/actions/runs/35527760360)
and [Work guide](https://github.com/jimmie-potts/agent-device-hub/actions/runs/35527760350).
All five passed, including Linux hook qualification. Product code, schemas,
fixtures, package inputs and OpenSpec are unchanged from the released source.
The earlier billing failures and stale apt-index failure remain historical
evidence. Issue #3 closed as completed after these results; #107's coordinator
also closed that issue. Coordination and Actions ownership are recorded on
[PR #108](https://github.com/jimmie-potts/agent-device-hub/pull/108#issuecomment-5751591521).
This guide follow-up makes no workflow changes.

[PR #109](https://github.com/jimmie-potts/agent-device-hub/pull/109) is the linked
source-guide companion. It preserves #108's guide changes, marks #3 and #107
completed, and retains their closed reference records. Refreshed all three open
inventories and native dependencies, plus paginated history pinned to each
observed main revision. The guide now represents 106 primary open issues,
12 guides, 49 roadmap nodes, 72 merged PRs and nine architecture viewers.
The roadmap recommends separately scoped first-host adoption in Pixoo #31;
Hub #8 still owns installed-provider qualification. Ownership, command flows and
architecture have not changed, so the viewer artifacts and their dated source
receipts remain unchanged. No new OpenSpec change is needed for this closeout.

Guide generation, all five maintenance tests and browser checks at 320, 390,
768, 900, 1000 and 1440 pixels passed, including links, search, timeline controls,
viewer interactions and print restoration, with no browser errors. Guide HTML
SHA-256: `3c3f9931bae93ab2bd9333a92fc3c460e4ef857aaba1e1d53223ba2513d229df`.
Screenshots, print output and verification receipts remain outside Git.
Fixed-revision independent reviews, generated-output consistency and the
[guide-only CI exception](../sdlc.md#guide-only-ci-exception) are recorded in
PR #109 before guarded merge. Public publication remains outside this request;
the last verified public edition records source `950f7f6` and eight viewers.
No installation, live state, agent sessions or devices were changed.

## 2026-09-20 UTC: Five Ubuntu CI checks for Hub #107

The delivery coordinator prepared [Hub #107](https://github.com/jimmie-potts/agent-device-hub/issues/107)
from main `f550bcd`, including the shared agent-state checks merged in PR #105.
The candidate removes native Windows jobs and combines controller, lifecycle and
agent-state validation into two Ubuntu jobs for Python 3.12 and 3.14. Workflow,
MCP and guide checks bring the total to five. Existing Linux suites, isolated
package consumers, performance checks, scheduling and timeout rules remain.
This is CI/tooling maintenance without a product or wire-contract change; no new
OpenSpec change is needed.

Refreshed all three backlog inventories and native prerequisite records, added
#107 to development-workflow primary coverage and the existing CI roadmap node,
and regenerated the guide. Recorded PR #105's observed source merge while #3
remains open. Kept #91's earlier thirteen-job measurements as historical evidence.
The candidate represents 108 primary open issues, 12 guides, 49 roadmap nodes
and nine architecture viewers. History and architecture retain their independent
source dates. CI consolidation changes no runtime ownership, command flow or
device boundary, so architecture sources and viewers need no changes.

Local validation passed with Node 24.21.0 and Python 3.12.13/3.14.4: all 32 retained
workflow/product command invocations, including fifteen workflow regression tests
and thirteen isolated Linux hook checks. The five-job regression first failed
against the old workflow with `13 !== 5`, then passed after consolidation.
Workflow validation reports six specifications, zero active changes and five
archives. Guide generation, all five maintenance tests and browser checks at
320, 390, 768, 900, 1000 and 1440 pixels passed, including print and viewer checks.
Guide SHA-256: `d4320d12979ff6488896172cf387af3114aca6a3eccd821e396317bd0a3f2cd7`.
Screenshots and the browser receipt stay outside Git.

The first hosted candidate ran exactly five jobs. Both Python versions, MCP and
the guide passed; workflow validation passed its fifteen tests but package setup
failed because the runner's stale apt index referenced a removed bubblewrap
archive. Added `apt-get update` before installation, preserving the AppArmor
profile and namespace check. The setup assertion failed before this fix and
passed afterward. This setup correction changes no guide output or architecture.

Specification review found an older next-work recommendation that still called
PR #105 unmerged. Reconciled it with the source-merge row, regenerated the guide
and repeated maintenance/browser checks successfully. Remaining #3 acceptance
and closure stay separate from its verified source merge.

Source synchronization is in this candidate; independent review and current-head
and merged-main CI remain required before completion. Public publication is
outside this request. The public repository still records source `950f7f6` and
eight viewers, so it does not represent this candidate. No public files, personal
installation, provider configuration or devices were changed.

## 2026-09-20 UTC: Reconcile Hub #3 with the merged guide policy

Resolved [PR #105](https://github.com/jimmie-potts/agent-device-hub/pull/105)
against main `897208ad31d48d10c1d4e45906a6c7a1c9101a4e`, which merged the
guide UI approval policy in PR #106. Retained both maintenance entries and
regenerated the guide from the combined inputs. The generated change contains
the two policy paragraphs from #106 and preserves #3's state-package coverage.
The [SDLC guide exemption](../sdlc.md#ui-approval-scope) supersedes the human UI
approval requirement recorded in the earlier #3 candidate entry. Independent
reviews, applicable CI and guarded merge remain required.

Validation passed under Node 24.21.0 and Python 3.14: build/type checks, all 96
agent-state Node tests, both Python tests covering the 36-case snapshot corpus,
workflow validation for six capabilities and five archives, all 15 workflow
tests, all five guide maintenance tests, and browser/print checks at widths
320, 390, 768, 900, 1000 and 1440 with no browser errors. The six capabilities
are `agent-lifecycle-contract`, `agent-provider-emitters`, `agent-state-core`,
`controller-contracts`, `shared-mcp-gateway` and
`shared-monitor-performance-baseline`.

Product source, schemas, fixtures, dependencies, CI and OpenSpec are unchanged
from #3's previously reviewed candidate. Ownership and command flows are also
unchanged, so no architecture redraw or new OpenSpec change is needed. All nine
viewers, source receipts and backlog/history dates are preserved. The guide
still contains 107 primary open issues, 12 guides, 49 roadmap nodes and 68
historical merges. Current revision reviews and hosted CI are recorded in
PR #105. Public publication remains outside this source delivery.

## 2026-09-20 UTC: Hub #3 agent-state source candidate

The Hub #3 candidate adds the shared state owner, host storage boundary, bounded
provider emitters, snapshot consumers and reproducible package archive. Updated
the shared Codex row, next-work recommendation, shared-system and lifecycle
diagrams, and migration explanation. Production hosting and durable adapters
remain Pixoo #31; installed qualification remains Hub #8. No hooks, personal
state, agent sessions or devices were changed.

Refreshed the three repository inventories. The guide contains 107 primary open
issues, 12 guides, 49 roadmap nodes and the existing 68-merge history. Added the
new, independently owned Hub #103 to development-workflow coverage and its own
roadmap track. Its PR #104 remains separate. History dates are unchanged because
this candidate does not predict a merge or close #3. Hub architecture pins point
to the candidate's source commit; other repository source pins retain their dates.

Validation: generation, five maintenance tests and browser checks at six widths
pass, including links, search, navigation, diagram controls and print. All nine
Archify artifacts pass 9/9 checks with no errors or warnings. Both changed
standalone viewers pass all four desktop containment checks and were inspected
in their rendered form. The lifecycle viewer needed two focused layout passes
to remove existing overflow and overlapping phase labels. Other viewers retain
their recorded baseline limitations. Screenshots, print output and hashes remain
in the external candidate receipt. Current-candidate UI approval remains required.

Independent review found child-identity and unordered-event defects. The
corrected source retains observations received before their turn starts,
retires turns only with established ordering, and excludes conflicting parent
evidence from child counts. Regression and shared snapshot coverage were
expanded. These corrections preserve the represented ownership and flows;
the package source pin is refreshed with the candidate.

The refreshed tracker snapshot records #3 in review with an account-billing CI
block. The account owner must restore Actions execution before current-head CI,
merge and closure can proceed.

The served public guide was checked and still matches its published
`950f7f62d502bc1d55d0f95872a4a10c08d4a27a` edition and recorded HTML checksum.
It does not contain this candidate. Public publication is outside #3's source
delivery; guide history/status need a follow-up after an eligible merge and
verified issue closure.

## 2026-09-20 UTC: Guide UI approval policy candidate

Repository: agent-device-hub, [PR #106](https://github.com/jimmie-potts/agent-device-hub/pull/106).
The owner requested a documentation update through `plan-work`, then authorized
source delivery through `deliver-work`. Remove human approval for guide UI while
retaining it for every other UI change. This candidate updates `AGENTS.md`,
`docs/sdlc.md`, the PR template and the guide procedure. Mixed changes still require approval for UI
outside the guide. Guide changes alone do not require renewed approval.
Independent reviews, guide/browser checks, applicable CI and publication
authority remain required; the CI path-filter exception is separate.

Updated the development-workflow guide's CI and Prism rows and regenerated the
HTML. Older human UI approval wording in guide issues #73, #85, #86 and #87 is
superseded by the new policy; reconcile those fields when tracker updates are
authorized. Their design, validation and dependency requirements remain. The
linked guide tasks remain open; this PR delivers only the approval policy.

Backlog/history snapshots, issue states, roadmap order and all nine architecture
viewers and receipts are unchanged. No ownership, command flow, product behavior
or contract changes, so no OpenSpec proposal or architecture redraw is needed.
Earlier entries retain the approval rules and evidence recorded at their dates.

Validation passed under Node 24.20.0: workflow checks validated all four specs
and four archives, and all 15 workflow tests passed. The current specs are
`agent-lifecycle-contract`, `controller-contracts`, `shared-mcp-gateway` and
`shared-monitor-performance-baseline`. Guide generation, all five maintenance
tests and browser checks passed at widths 320, 390, 768, 900, 1000 and 1440,
including navigation, search, links, timeline controls and print restoration,
with no browser errors. Repeated generation preserved all ten HTML hashes;
the complete output diff contains only the two intended policy paragraphs.

Static instruction scenarios cover guide UI, other UI, mixed changes, approval
renewal, older guide issue wording, publication authority and independent CI
scope. These are document exercises, not live agent-session verification.
This entry records candidate preparation. PR #106 records independent reviews,
hosted CI and merge evidence as they are verified. Public publication and live
verification remain separate from this source delivery.

## 2026-09-20 UTC: Add API and database references to #103 / PR #104

Extend the BUNNY HTML candidate with three local Scalar viewers and downloadable
OpenAPI 3.1 files for 37 explicit REST/SSE operations. Generate SchemaSpy reports
for 28 tables across Pixoo's library, its separate ownership lock and Nanoleaf's
state store. Inputs come from pinned source commits, with file hashes and route
ownership recorded beside the references. No installed controller, live SQLite
file or physical device is contacted. Browser request controls remain disabled;
same-origin integration and installed-client testing remain future service work.

Link the references from all design navigation and the Pixoo, Nanoleaf and
storage documents. The HTML runbook records source refresh, generation and
verification commands. Update the development-workflow guide's #103 entry and
refresh all three backlog inventories. The refresh also captures current Hub #3
labels and the Nanoleaf #29/#41/#42/#43 Linux-baseline planning edits. Coverage
remains 12 guides, 107 primary open issues, 124 linked issues and 48 roadmap
nodes. The existing nine architecture viewers and 68 merged PR history records
are unchanged because this addition changes no runtime ownership or command flow.

Validation: all three OpenAPI files pass Swagger Parser 13.0.0 validation. The
source-only extraction tests pass. Two SchemaSpy rebuilds with a single scan
thread produce identical file receipts. Static checks verify 28 reading pages and
53 reference pages, source pins, all table metadata, bundled asset hashes and
local links. Browser checks pass for every API operation and table, Scalar
search, desktop/mobile layouts, offline assets and absence of page errors or
external requests. Node 24 workflow validation reports four specifications and
four archived changes; all 15 workflow tests pass. Guide generation, five
maintenance tests and the guide browser checks pass.

The guide SHA-256 is
`04c81b8bca48e1b278dfebbcfdfb76693bafa3ca9ffed847fb21d90cb6adee97`.
The reference entry page SHA-256 is
`29af5f6ee00fb81f2bc5e55d742ffcec157770f6df99504d123b48f33f9b70e2`.
Current-candidate independent review, successful hosted CI and explicit human
UI approval remain required before merge. No installation or deployment is
claimed. A fresh unauthenticated public-guide read still returns SHA-256
`0f37a2db680f075952c3e055892b5efef4d5d6c366cf20c0f0e9e04aa706f55c`;
public publication remains outside this task and has not changed.

## 2026-09-20 UTC: BUNNY HTML system design candidate for #103

Add a linked HTML overview, 26 component documents, a combined reading/print
view and one explorable state/action diagram under `docs/system-design/`.
The documents adapt the composable template approach from the Map Distributed
System Design Docs task. They distinguish delivered contracts and source from
planned modules, qualification work and optional hosting choices. Editable HTML
fragments and a JSON inventory regenerate the reading pages without overwriting
the authored content. No product capability or OpenSpec scenario changes.

Refresh all three issue inventories through the existing REST/GraphQL helper.
Place #103 in the development-workflow guide and its CI/documentation timeline
node. The guide contains 12 guides, 107 primary open issues, 124 linked issues,
48 roadmap nodes and the existing 68 merged PR records. No state owner, command
flow, controller contract or failure boundary changes; retain all nine existing
architecture viewers and their receipts. The additional diagram illustrates the
same boundaries in the separate system design set.

Validation: Node 24 setup and workflow validation pass for four specifications
and four archived changes; all 15 workflow tests pass. Extend the existing CI
regression to retain the old guide checks alongside the new document checks and
review artifacts. Document verification passes for 28 reading pages and 1,022
local links. Browser checks cover desktop/mobile navigation, search, no-result
states, both themes, all component pages and print output, with no page errors
or external requests from the reading pages. The architecture diagram passes
all nine checks and its desktop browser containment/readability checks.

Guide generation, all five maintenance tests and browser checks pass at widths
320, 390, 768, 900, 1000 and 1440. Generated guide SHA-256:
`b699e3652063f93ae134c75602d4fd8c6f51d6b207dc9361529d086ed656edbb`.
The HTML overview SHA-256 is
`7257c2ef07b650074ef86afd5b7a1d8de209893cd95b6c5fd1be66618cf7b92e`.
Independent review, hosted CI and explicit approval of the current HTML
candidate remain delivery gates; this entry does not claim merge or deployment.

The unauthenticated public guide returned HTTP 200 with SHA-256
`0f37a2db680f075952c3e055892b5efef4d5d6c366cf20c0f0e9e04aa706f55c`.
It differs from this candidate. Public publication is outside #103; source
synchronization here does not update or verify a deployed copy of this change.

## 2026-09-12 UTC: Reconcile the merged #77 baseline and closed #99

PR #77 merged as `1fd353215532a5d0220b99d9b35b6da0436221cc` on
September 12 UTC, including PR #99's guide inputs and output. PR #99 is closed
as superseded. Updated issue #30 to record the early source baseline, link the
merged report and budgets, and retain the open integrated acceptance criteria.
The owner excluded further #77 CI verification from this reconciliation; this
entry does not claim successful merged-main CI.

Updated the shared Codex qualification row and next-work recommendation to use
the merged baseline for dependent runtime designs. Refreshed all three backlog
inventories and paginated history, recording the source merge separately from
installed-client, device and public-publication evidence. Historical candidate
entries below remain dated records, superseded by this closeout.

The refresh also observed #100 closed after PR #101 merged. Removed it from open
primary coverage and the remaining-work map, retained its completed reference,
and taught the refresh helper to preserve that reference. The guide now contains
106 primary open issues, 12 guides, 48 roadmap nodes and 68 merged PRs.

Validation: guide generation and all five maintenance tests passed. Browser
checks passed at widths 320, 390, 768, 900, 1000 and 1440, including navigation,
search, links, timeline controls and print, with no browser errors. Generated
output consistency and whitespace checks are recorded with the candidate PR.
Architecture no-impact: no owner, command flow, contract or device behavior
changed; all nine pinned viewers and architecture receipts remain unchanged.
This is documentation/status reconciliation with no product capability delta,
so no new OpenSpec change is needed. Current-candidate review and UI approval
remain the documentation PR's gates. Public publication is outside this task.

## 2026-09-12 UTC: Guide-only CI candidate for Hub #100

Hub #100 proposes excluding changes entirely under `docs/work-guide/` from both
Hub CI workflows, including guide generators and checks. Mixed changes retain
all configured jobs. This candidate documents the narrow SDLC exception and its
local validation, review and required-check evidence. Hosted skipping is not yet
verified, and the issue remains open.

Refresh the three repository backlogs through the existing REST/GraphQL helper.
Add #100 to the development-workflow guide and CI/guide-maintenance timeline
node, with exactly one primary placement. The refreshed inventory contains 107
open issues across 12 guides. Architecture ownership and the nine pinned viewers
do not change; no architecture redraw is needed. Preserve the existing history
snapshot date because this candidate records planned behavior, not a new merge.

Validation: Node 24 setup succeeded; workflow validation passed for four specs
and four archives, and all 15 workflow tests passed. The new filter regression
failed before the YAML edits and passed afterward. The guide-job regression
rejects removal of the maintenance-check step. Guide generation, all five
maintenance tests and browser checks passed, with no browser errors. Retain
screenshots, print output and the exact HTML hash in the candidate review receipt.
Generated-output consistency is checked after committing intended output.
Independent reviews, current-candidate UI approval and hosted CI remain delivery
gates. Guide source synchronization is included here; public publication and
live public verification are outside #100's source-delivery scope.

## 2026-09-10 UTC: Nanoleaf Linux source delivered

Nanoleaf PR #57 merged as `2558df5a2fc543247b0c75898ef0260ba3ea264b`.
Both independent reviews found no issues, and all nine PR and nine merged-main
jobs passed. Nanoleaf #54 closed as completed after that readback. Hub PR #84
already delivered the architecture companion. This #43 follow-up records the
actual source outcome in the canonical architecture, roadmap and maintained
guide. Nanoleaf #55 remains open for installed WSL, real-client and physical
acceptance; Hub #43 remains open for that outcome and its documentation.

Refresh all three backlogs through complete REST and GraphQL reads at
`2026-09-10T23:12:39.923407+00:00` and source histories at
`2026-09-10T23:03:12.326361+00:00`. Retain #54 as a completed reference and #55's
operator handoff through direct reads. Remove #54 from primary open coverage
and mark its roadmap node delivered. Preserve all concurrent PC lighting,
Prism, CI and guide-checkpoint work.

No controller ownership, command flow or failure boundary changes in this
follow-up. It needs no product OpenSpec delta or architecture redraw. The nine
viewers and their source pins remain the dated proposal at the recorded
architecture review; the guide now explicitly distinguishes that historical
view from delivered Linux source. Installed behavior remains unverified.

Validation: guide generation, five maintenance tests and browser checks pass.
Closing #54 exposed a maintenance assertion that incorrectly expected closed
prerequisites to remain in the open-work roadmap. Its recorded failure expected
N54 → N55 after #54 closed. The test now compares only open native blockers,
as the adjacent ordering test already does. Native dependency evidence retains
the closed source prerequisite. No product behavior changes.

Standards review HSTD-01 found that the newly added acceptance reads copied
private coordinator metadata from raw issue comments into the repository.
Nanoleaf #54/#55 now retain only comment URLs and timestamps, with full comments
available through GitHub when needed. A regression failed on the raw `body`
field before this correction and passes against the refreshed records. The
snapshot identifies which reads retain bodies and which retain references.
The generated guide never included the private comment content.

Browser verification covers six widths from 320 to 1440, all nine viewers,
search, navigation, coverage, diagram and timeline controls, and print
restoration, with no page errors. The desktop timeline was also inspected.
Node 24 workflow validation passes for three specifications and three archived
changes; thirteen workflow tests pass. The guide has 107 primary open issues,
122 linked issues, 12 guides, 48 roadmap nodes and 65 merged PR records.
Generated HTML SHA-256:
`56eba1cba6daacacbc7975a9303494a0b5ee884f9509d50267b3bcb95e5c5d08`.

Public publication is outside this source wrap-up. The public repository README
still identifies Hub source `950f7f62d502bc1d55d0f95872a4a10c08d4a27a` and eight
viewers. This Hub follow-up does not update or verify the live public edition.

## 2026-09-10 UTC: retain the concurrent Hub #91 completion

Main advanced again during PR #84's final readback. Merge
`6e94511119ae0b9289fb34f90e09cafa956f18f6`, preserve Hub #91's completion
and its complete `2026-09-10T22:07:11.512935+00:00` backlog snapshot, and
regenerate the guide. The four maintenance tests and browser checks pass again;
there are 108 primary open issues, 122 linked issues, 12 guides, 48 roadmap
nodes, 61 merged PRs and nine diagrams. The guide SHA-256 is
`a00a0113778c7fa0e68dab2a338a6a61b855003cc21c0439291b9b4438f9700c`.

All nine architecture viewers remain unchanged. Workflow inputs are unchanged
from this turn's passing Node 24 checks. The prior merge's CI results belong to
that revision; the new head requires its own hosted checks and renewed reviews.
The requested finish line remains the updated PR branch.

## 2026-09-10 UTC: Hub #91 CI efficiency completed

Hub #91 is closed as completed after the remaining guide-workflow acceptance
passed. PR #82 merged at `8872be1f80f47c35b89faeab3724fedc0402e9f6`.
All twelve core jobs passed in main run `34530817100`, and the guide browser job
passed in main run `34530817142`. Its reviewed head also passed all thirteen
jobs. Core scheduling and build-once commands were already delivered through
PRs #92 and #93, with guide-source reconciliation in #94.

Refresh the three complete backlogs and source histories after closure. Retain
#91 through a direct acceptance read, remove its primary open-issue and roadmap
membership, and mark the existing development-workflow row completed. Preserve
the remaining CI/guide maintenance issues and concurrent guide changes. The
32-to-10 full-build reduction retains every test and platform. One main sample
fell from 814 to 664 runner-seconds and 19 to 18 rounded minutes; mixed PR
samples do not establish monthly billing savings. Warm pip restoration was
observed for all four OS/Python combinations in the natural #94 PR run. Live
superseded-run cancellation remains unobserved, as allowed by #91.

This closure changes no product behavior, controller ownership, command flow or
failure boundary. It needs no product OpenSpec delta or architecture redraw;
preserve the eight viewers, pins and architecture evidence dates. Guide-only
reconciliation adds no product milestone. Public-site publication and live
public-page verification are outside this source delivery.

Validation: Node 24 setup, workflow checks and thirteen workflow tests passed;
the inventory remains three specifications and three archived changes. Generation,
four maintenance tests and browser checks passed for six viewport widths,
search/navigation, controls, diagrams, timeline, print and all eight viewers.
The snapshot has 108 primary open issues, 12 guides, 48 roadmap nodes and 61
merged PR records. Generated HTML SHA-256:
`d9f979a601032d246aa203739c80c5a7ee39768784d0cc34473d0e1644af26b9`.

## 2026-09-10 UTC: resolve Hub #84 conflicts after guide delivery

The Hub #43 coordinator reconciles the existing PR #84 branch with main through
`950f7f62d502bc1d55d0f95872a4a10c08d4a27a`. Preserve the completed Prism
stories, CI improvements, guide checkpoint adoption and publication evidence
from main. Keep its complete backlog snapshot from
`2026-09-10T21:55:33.450036+00:00` and history inputs unchanged. Retain PR #84's
Linux proposal and the distinction between source work, installed acceptance and
final architecture reconciliation under Nanoleaf #54, #55 and Hub #43.

Resolve the README's publication inventory to nine viewers and ten HTML files,
retaining the new content-inspection requirements. Keep each guide workflow row
once and retain the delivered Prism and checkpoint timeline markers. Regenerate
the HTML from the reconciled inputs. Architecture definitions, source receipts
and all nine viewer files match the previous PR head `137a88d` byte for byte.

The guide build, four maintenance tests, browser checks and whitespace checks
pass. The guide contains 12 guides, 109 primary open issues, 122 linked issues,
48 roadmap nodes, 60 merged PRs and nine diagrams. Browser checks cover widths
320 through 1440, issue coverage, links, search, navigation, diagram and timeline
controls, and print restoration, with no page errors. Under Node 24, workflow
validation passes for three specifications and three archived changes; all
13 workflow tests pass. The final guide SHA-256 is
`4fd4ce05d0efe5b5fa24d642868b4c05363a7c911b9b07fada322c58f9458676`.

The public repository README still identifies source `8499950` and eight
viewers. PR #84's ninth viewer remains unpublished. This request updates the
existing PR branch only. Source merge, guide publication, live verification,
installation and physical acceptance remain outside this conflict-resolution
step. Earlier independent reviews describe their recorded revisions and need
renewal against the final comparison before merge.

## 2026-09-10 UTC: Hub #83 publication and completed status

The user authorized public publication. Public guide PR #2 merged at
`352ac6a52f4933a2837acee2eef8b76513989644`, publishing exact Hub source
`84999503f227284db7b8095afbcac22bafbf1d54` after all thirteen source main
jobs passed. Both independent review axes approved the public candidate. Pages
run `34534387078` passed all three deployment jobs. At 21:52:34 UTC, the
unauthenticated landing page and all eight viewer URLs returned HTTP 200 and
matched their reviewed source hashes. The landing-page SHA-256 was
`309d517cf9171a7ff4e0c63841f4b1585e000b1c9612389b58b2fe4869c698b2`.

Hub #83 closed as completed at 21:53:17 UTC. This linked follow-up refreshes the
three paginated backlogs and histories, retains #83 through an explicit direct
read, removes it from primary open-issue coverage, and marks its existing timeline
node delivered. Record its completion in the development-workflow narrative.
The unchanged external agent-skills #33 reference remains outside primary totals.
Guide-only maintenance and publication receipts do not add product milestones.

The first refresh immediately after closure encountered a closed issue in the
GitHub open-issue response. Snapshot and coverage assertions rejected that
unpublished candidate. A later complete REST/GraphQL refresh reconciled all
three repositories and passed generation plus all four maintenance tests. The
verified public edition remained intact throughout recovery.

These changes affect source status and publication evidence. They change no
runtime ownership, command flow, failure boundary, product behavior or OpenSpec
specification. Preserve all eight architecture viewers, definitions, source pins
and evidence dates, the guide controls and appearance, and Hub #73's reserved
input. Hub #80 and #91 retain their separate owners. Run canonical guide and
workflow checks, independent reviews and all configured source CI; publish the
verified merged status snapshot and check all nine served hashes again under
the existing publication authority. Keep each actual revision and result in the
delivery receipt.

## 2026-09-10 UTC: Hub #83 approved source integration

The user approved the guide candidate and its desktop, mobile and print review.
Reconcile later source changes while preserving its appearance and controls.
Hub PR #82 merged at `8872be1f80f47c35b89faeab3724fedc0402e9f6` and passed
all thirteen main jobs. Preserve its guide-workflow scheduling and dependency
tracks, together with the core CI improvements from PRs #92 and #93. Hub #91
keeps its separate measurement and completion owner.

Pixoo companion PR #56 merged at
`9f1c0ec75651810a441606b0c08fbdeee824c8d8`; Nanoleaf companion PR #59 merged
at `1b7c3f490e288674ab37914f86f59996722a5d69`. Both merged trees match their
reviewed candidates. Main-CI outcomes are recorded separately in the delivery
receipt. Refresh all three backlogs and histories. The Prism owners completed
Nanoleaf #52, #53 and #26 after their source and guide gates; remove those closed
issues from primary coverage, retaining their source history and completion narrative.
Reconcile concurrent Hub PR #95, including its completed Prism timeline markers
and owner-written acceptance text. Its guide-only merge is recorded here; the
complete 21:20 UTC snapshot already captures the same authoritative closures
and the later Nanoleaf checkpoint merge, so preserve those dated inputs. This snapshot has 110 open issues.

Architecture no-impact remains unchanged. Instruction adoption, CI scheduling
and these status/history updates alter no represented device ownership, command
path or failure boundary. Preserve the eight viewers and their evidence dates.
Source merges/main CI, guide synchronization, public publication and live
verification remain separate stages. This approval does not establish public
deployment, installed-client behavior or physical acceptance.
## 2026-09-10 UTC: Prism stories completed

Nanoleaf #52, #53 and #26 are closed as completed after their source PRs
#56, #58 and #60, independent reviews, approved integrated UI and all nine
main jobs per source revision. Hub companion PR #82 merged at
`8872be1f80f47c35b89faeab3724fedc0402e9f6`. Its tree matches the reviewed
candidate, and all thirteen main jobs passed in runs `34530817100` and
`34530817142`. The user approved proceeding and instructed that story/status
guide updates require no further human approval within this delivery.

This linked follow-up refreshes all three paginated backlogs and source
histories after the authoritative closures. Remove the three completed stories
from primary open-issue coverage and roadmap membership. Keep their references,
delivered sequence and acceptance evidence. Record PR #82's guide-workflow
acceptance while leaving Hub #91's final reconciliation to its separate owner.
Preserve every concurrent maintenance entry and Hub #73's reserved input.

Only source status, history and membership change. Guide controls, architecture
ownership, command flows, definitions, source pins and all eight viewers remain
unchanged. No product behavior or OpenSpec delta applies. The canonical build,
both maintenance tests and six-width browser checks pass with 110 primary open
issues, 122 linked issues and 48 roadmap nodes. Exact hashes, independent
reviews and hosted checks are recorded in the follow-up PR.
This guide-only reconciliation is a maintenance record and does not require a
recursive product milestone. Installation, physical-light operations and public
publication remain outside this source delivery.

## 2026-09-10 UTC: Prism source verification and final guide reconciliation

Nanoleaf connector PR #56, renderer PR #58 and numbering PR #60 are merged.
Their source revisions are `cdceffddb7a86c138797325e8d6b0460eb320e58`,
`2944a3a0a7ce58da0a36125859d7d3f277bece76` and
`b8b144bc8f92668688db278e9401e46e00b7c6ae`. Each passed all nine required
main jobs in runs `34419199684`, `34481751959` and `34483393699` respectively.
The user approved the integrated app UI and an earlier guide candidate. The
reconciled guide awaits renewed approval. Both independent review axes
are clear for the app candidates. The three issues remain open only for this
source-guide synchronization. Installation and physical acceptance are separate.

Reconcile Hub PR #93 after PR #92, preserving its build-once commands, caches,
workflow regression tests and development instructions. Both core candidates
passed all twelve PR and main jobs. The #91 coordinator retains measurement
and completion ownership; the proposed guide workflow is still supplied here.
Keep all maintenance entries from concurrent deliveries and refresh the three
backlogs and source histories. The guide records current source results without
claiming Windows billing savings or observed overlapping-run cancellation.

Guide appearance, controls and eight architecture viewers remain unchanged.
Only factual status, source history and issue membership are reconciled. Runtime
ownership and command flows are unchanged, so diagram definitions and pinned
sources need no redraw. Preserve Hub #73's reserved input. Rebuild and inspect
the guide, run maintenance/browser checks and Node 24 workflow checks, then
renew independent review and current-head CI. Record exact receipts in PR #82.
Public publication remains outside this delivery.

## 2026-09-10 UTC: Approved Prism UI and source merge checkpoint

The user approved the integrated Nanoleaf Prism UI in PRs #58 and #60 and this
source guide in PR #82. Renderer PR #58 merged at
`2944a3a0a7ce58da0a36125859d7d3f277bece76`, with all nine PR and main jobs
passing. Connector PR #56 was already verified at
`cdceffddb7a86c138797325e8d6b0460eb320e58`. Numbering PR #60 merged at
`b8b144bc8f92668688db278e9401e46e00b7c6ae` after all nine current-head PR
jobs passed in run `34482808650`. Main CI remains pending at this snapshot.
Its earlier browser run passed 360 raw clicks and 720 label-clearance checks,
then exposed an observer removed before an in-flight poll rendered Work mode.
A delayed-poll reproduction distinguishes that test race from a failed UI mode
change. The corrected observation retains exact phase equality and the 50 ms
continuity boundary and rejects an injected reset. Both renewed independent reviews are clear and the full local browser suite
passes. Main verification continues in PR #60. No further artwork change is
introduced.

GitHub prematurely completed #53 when the PR description contained a closing
keyword inside a negative instruction. The coordinator removed the trigger and
reopened the issue until this guide gate completes. Source merge and successful
main CI remain verified. Preserve tracker events and source dates separately.

Reconcile concurrent guide PRs #89 and #90 through their owning inputs, retaining
Pixoo #46 and Nanoleaf #37 completion and every maintenance entry. Refresh all
three paginated backlogs and histories, including direct Prism issue evidence.
Represent newly recorded Hub #91 as planned CI savings work. Preserve the
approved guide layout and style, all eight architecture definitions and viewers,
and the reserved Hub #73 input. These status updates change no runtime ownership
or command flow. Regenerate through the canonical builder and run build,
maintenance and browser checks. Exact hashes and independent review belong in
PR #82. Public publication and installation remain separate work.

Reconcile the later core CI policy from Hub PR #92 without changing its files.
The companion guide workflow now also runs on PRs and main pushes, cancels
superseded PR revisions and keeps its ten-minute limit. Its job steps, action
pins, permissions, browser checks and artifact retention are unchanged. A
focused configuration check rejects the old duplicate-trigger policy and passes
the updated policy. Node 24 workflow validation passes three specifications,
three archives and eleven tests. Hub #91 remains separately owned and open for
its remaining build optimization, measurement and completion work.

## 2026-09-10: Hub #91 verified core CI delivery

Coordinator: the Hub #91 delivery root. Scheduling PR #92 merged at
`bca5b343dffef69b2eb371af683b6c8839bb2f3e`; build-once/cache PR #93 merged at
`589f95e274fd441867910e639af29a026db51577`. Both had independent Standards
and Specification reviews and all 12 current-head PR jobs passed. All 12 main
jobs passed in runs `34482410679` and `34483708694`, respectively. All original
tests and platform combinations remain. Branch updates produced PR runs without
duplicate push runs. Runtime overlapping-revision cancellation is unobserved.

The successful main samples used 814 runner-seconds before build deduplication
and 664 afterward. Per-job rounding totals fell from 19 to 18 minutes. Linux
fell from 262 to 176 seconds and Windows from 552 to 488. The PR samples were
mixed: Linux improved, but Windows archive/setup variability increased time.
These observations do not establish monthly billing savings. Full-build count
fell from 32 to 10. Successful cold-cache jobs populated pip caches for all four
OS/Python combinations; warm restoration remains to be observed.

Refresh the paginated source history and the development-workflow row to record
core delivery without claiming #91 is complete. The guide workflow on its
owner's PR #82 at `c80f8bcc94f6ff2b382107baf6edbbe723e2a478` now has matching
main-only push triggers, concurrency, timeout and preserved browser/artifact
checks. That PR remains unmerged; its current-head and main verification are
still required. #91 remains open for that owner-controlled acceptance.

Guide generation, maintenance and browser checks pass with 113 open issues,
54 merged PR history entries and unchanged architecture/viewer hashes. This
follow-up records source acceptance, not product or device behavior. No OpenSpec
delta applies. Preserve Hub #73's reserved input. Public publication and live
served-byte verification remain outside this source delivery. This guide-only
reconciliation need not be recursively added as a product milestone.

## 2026-09-10: Hub #91 build-once candidate and scheduling readback

Coordinator: the Hub #91 delivery root. PR #92 merged at
`bca5b343dffef69b2eb371af683b6c8839bb2f3e`. All 12 current-head PR jobs passed
in run `34481962695`, and all 12 main jobs passed in `34482410679`.
An ordinary branch update produced only the PR run. Live overlapping-revision
cancellation remains unobserved. The scheduling source is delivered; #91 stays
open for the build-once candidate, measurements and guide-workflow reconciliation.

Refresh paginated source history and backlog inputs. Record Nanoleaf #37's
verified closure and remove it from open coverage and roadmap membership.
The development-workflow row keeps Hub #91's remaining acceptance explicit.
This candidate preserves every test payload and platform while reducing full
builds from 32 to 10 per core run. Python setup caches downloads; installation
and archive-consumer validation remain. The standalone commands still compile
first and stop on failure. No product behavior or OpenSpec delta applies.

Guide generation, maintenance and browser evidence belong in the PR receipt.
Architecture definitions and all eight viewers are unchanged. Preserve Hub #73's
reserved input. Public publication and live served-byte verification remain
outside this source delivery. The proposed guide workflow still belongs to
PR #82; this candidate does not edit another coordinator's branch.

## 2026-09-10: Hub #91 CI scheduling candidate

Coordinator: the Hub #91 delivery root. Add #91 to the development-workflow
guide and refresh the three repository backlogs from paginated GitHub reads.
The issue remains in progress; scheduling delivery, compilation optimization
and measured savings are pending. This first candidate restricts core push
checks to main, cancels superseded PR runs and bounds jobs to ten minutes.
Every existing matrix entry and test command remains. PR #82 separately owns
the proposed guide workflow; its scheduling must be reconciled before #91
is complete. No product behavior or OpenSpec delta applies.

Architecture ownership, diagrams and viewer files do not change. Preserve
Hub #73's reserved input. Candidate checks and reviews belong in the PR receipt.
Public publication and served-byte verification remain separate and pending.

## 2026-09-10 UTC: Nanoleaf #37 CI scheduling delivery

[Nanoleaf #37](https://github.com/jimmie-potts/codex-nanoleaf/issues/37)
source merged through [PR #61](https://github.com/jimmie-potts/codex-nanoleaf/pull/61)
at `dd5005edf8bcdaf3a7b5d999fb1f5582d10ee0aa`. Both independent review axes
were clear. All nine PR jobs passed in run `34431669004`; all nine merged-main
jobs passed in run `34431911171`. The guarded squash merge preserved the
reviewed workflow. Push validation now targets main, obsolete revisions of each
PR share a concurrency group, and workflow, Python and browser jobs have
ten-minute limits. The two MCP jobs and every existing command remain intact.
Live overlapping-revision cancellation was not observed; no artificial overlap
or timeout was induced. No product specification, installation or device change
applies.

The Nanoleaf delivery coordinator owns [Hub companion PR #90](https://github.com/jimmie-potts/agent-device-hub/pull/90).
The user approved its guide candidate `c2eb905`, but main advanced before merge.
Hub PR #89 already refreshed the overlapping backlog, primary coverage and
history, including Nanoleaf PR #61, and corrected the timeline title. Preserve
that newer input set and regenerate from it. The resulting HTML is byte-identical
to main: this reconciliation adds only this delivery record. The dated snapshot
correctly retains #37 as open at its recorded cutoff; source acceptance is
verified and issue closure awaits this companion's merge and main-CI readback.
No additional architecture, roadmap or UI change is needed. Preserve all eight
viewers, existing snapshot dates and Hub #73's reserved evaluation input.

Validation: guide build and maintenance regression pass; generated HTML is
unchanged from main. Independent reviews and hosted checks for the reconciled
candidate are recorded on PR #90. Public website publication remains outside
this source-only delivery.

## 2026-09-10 UTC: Hub #83 conflict reconciliation and CI retry

Reconcile Hub PR #88 with main revision
`396c36aed74cf1d016564536eca13bb16f89834b`, preserving PR #89's Pixoo #46
completion record and the newly represented Prism guide stories #85–#87.
Refresh the paginated backlogs and merge histories, then regenerate the HTML
from reconciled coverage, narrative and roadmap inputs. The snapshot now has
113 primary open issues; Pixoo #46 is closed, while Nanoleaf #37 remains open
despite its source PR #61 having merged. Native prerequisites retain
Nanoleaf #52 -> #53 -> #26 and #54 -> #55 -> Hub #43.

The linked Pixoo #56 and Nanoleaf #59 branches also incorporate their current
main revisions, including the delivered CI scheduling changes. Preserve all
configured jobs and retry validation on the new PR heads. Record exact heads,
independent review and hosted outcomes in the delivery receipt. This entry
claims no source PR merge, public publication or live acceptance for Hub #83.

No represented architecture ownership, command flow or failure boundary changes.
The eight viewers, architecture definitions, source pins and receipts remain
unchanged. Hub #73's reserved connector evaluation and other coordinators'
open guide work retain their ownership.

## 2026-09-10 UTC: Hub #83 planning and delivery checkpoints

Coordinator: the Hub #83 delivery root. Consume agent-skills #33, delivered in
PR #36 at `ff80d247ea96a5d4c461d30a2c24148376197c7b` with both configured
merged-main jobs passing. Align the Hub, Pixoo and Nanoleaf instruction paths
with the canonical guide procedure and the skills' explicit invocation rule.
Keep ordinary repository maintenance and narrower user limits intact. No
personal skill installation or product behavior/OpenSpec change is part of this
documentation adoption.

Refresh all three backlogs and merge histories through paginated GitHub reads.
The current plan includes Hub #83 and #80, the Nanoleaf #52 -> #53 -> #26
acceptance sequence, and the independent #54 -> #55 -> Hub #43 Linux sequence.
Reference the completed external agent-skills #33 prerequisite without adding it
to the three-repository primary totals. These stories retain their actual open
states; source delivery, installation and physical acceptance remain separate.

Architecture no-impact: these checkpoints change instruction discovery, guide
maintenance and publication evidence. They change no device writer, controller
boundary, command path, transport or failure behavior represented in the eight
viewers. Preserve their source pins, review dates, definitions and byte hashes.
The roadmap membership and one new independent work track reflect current
planning; they do not repair diagram connectors. Hub #73's reserved evaluation
input remains revision `7464b9e669c7150f780b334a3429c5f30a89b438`, HTML SHA-256
`8385675bb5dc6801de4c5f99e377caea2d281a2102ab6ce75b265bbac4cea6b3`.

Hub PR #82 remains separately owned. Use its inspected read-only guide CI job
without altering that branch, and reconcile any target changes before merge.
That job builds offline, checks reproducibility and captures browser/print
evidence; it has no deployment credentials or publication step.

This entry records a source candidate. Linked source/Hub PRs, current reviews,
CI, visual approval and exact revisions belong in the delivery receipt. After
verified merges, reconcile facts unavailable at this snapshot in a linked
follow-up. Public publication and all nine live URL/hash checks remain separate
stages under the user's publication authority. Hub #80 retains its existing
initial-publication acceptance owner. No deployment or live verification is
claimed by this maintenance entry.
## 2026-09-10 UTC: Prism source and review checkpoint

The Nanoleaf Prism coordinator reconciled connector source PR #56, merged at
`cdceffddb7a86c138797325e8d6b0460eb320e58` with all nine main jobs passing.
Issue #52 stays open for this guide synchronization. Artwork PR #58 and numbering
PR #60 have passing local browser evidence and independent reviews recorded in
their PRs. Hosted execution resumed after the earlier account restriction;
Windows checks passed and the slower browser exposed timing assumptions in the
presentation tests. Those tests now observe painted attributes in the same
browser turn and measure elapsed Work time from the actual resume transition.
The 50 ms phase boundary remains in force, and a deliberate reset defect fails
the corrected check. Current-head checks and reviews are renewed in the PRs.
Human approval of the current UI and source delivery remain pending. No
installation or physical-light change is recorded.

Refresh all three paginated backlogs and histories. Reconcile primary coverage
for 114 open issues, including newly planned Hub #83 and #85 through #87. Their
workflow adoption and guide-specific Prism design, implementation and distribution
remain separate deliveries. The agent-skills #33 prerequisite is an external
reference, excluded from the three-repository totals. Preserve native dependency
direction and record source merge dates separately from issue completion.
Use relative track headings so the independent Prism and Linux sequences do not
appear to wait for the shared Codex milestone solely because of their column.

Independent review found that the primary hosting table used a coordination dot
where the roadmap showed the required Nanoleaf #55 to Hub #43 dependency.
Use the full #54 → #55 → Hub #43 sequence in both views. Extend the native-edge
regression to the newly represented Hub #85 → #86 → #87 chain; a temporary
inversion of #85 and #86 fails that check, while the correct sequence passes.

The guide's dated source history and roadmap change. Runtime ownership and command
flows do not, so the eight architecture definitions, source pins and viewers stay
unchanged. Hub #73's reserved connector-repair input remains untouched. Regenerate
the guide and run its build, maintenance and browser checks with the cached Chromium
headless shell. Workflow checks also pass under the required Node 24 runtime.
Candidate hashes, reviews and CI belong in PR #82. Public guide publication
remains outside this task.

## 2026-09-09 UTC: Nanoleaf Prism delivery candidate

Coordinator: the Nanoleaf Prism delivery root. Record the accepted dependency
sequence Nanoleaf #52, #53 and #26 in the presentation guide and roadmap.
Connector source validation is underway in Nanoleaf PR #56.
Independent review caught an introduced hosting dependency. Put the Linux
#54 → #55 → Hub #43 sequence on its own row, leaving the other hosting
nodes at their prior stages. A regression compares the new Prism/Linux edges
with the native dependency records; it failed before this correction. Keep crystal
rendering and luminous labels pending their reviewed source delivery and current
UI approval. Tray artwork and physical-light changes are outside this delivery.

Refresh the paginated backlog snapshot and reconcile primary coverage for all
110 open issues, including the separately planned fresh Linux source #54 and
installed acceptance #55. Those stages reuse the wall UI and do not block Prism
component preparation. Hub #80 records the separate public hosting work. This
companion changes no runtime ownership or command flow, so the eight architecture
definitions and their pinned evidence remain unchanged. Hub #73 retains its
reserved diagram-repair scope and evaluation input.

Regenerate the guide from its owning inputs. Add hosted execution of the existing
build, maintenance and browser checks with screenshot/PDF receipts because the
local browser cannot create its required socket. No product behavior or OpenSpec
delta is needed. Candidate checks, independent reviews, exact hashes and UI
approval belong in the PR receipt. Public guide publication is not part of this
source-delivery request.

## 2026-09-10: reconcile Hub #84 with the latest main

Merge main `396c36aed74cf1d016564536eca13bb16f89834b`, delivered by Hub PR #89,
into the existing Linux documentation candidate. Retain main's complete backlog
snapshot from `2026-09-10T03:15:26.069234+00:00`, its history inputs and Pixoo
#46 completion. Preserve this PR's Linux architecture, source pins, nine viewer
files and separate source, installation and documentation owners.

Resolve the generator and roadmap conflicts so Linux and Prism issues each
appear once. Combine the duplicate Prism and public-guide rows while keeping
the new development-workflow issues from main. Regenerate the HTML from those
inputs. No tracker state, product contract, installed runtime or public website
changes are part of this conflict resolution.

The guide build, maintenance test, browser checks and whitespace checks pass.
The merged guide contains 12 guides, 113 primary open issues, 121 linked issues,
44 roadmap nodes, 48 merged PRs and nine diagrams. Backlog/history files match
main byte for byte; architecture definitions, receipts and viewer files match
the previous PR head. Earlier review and CI receipts describe their recorded
revisions; the new comparison still needs current delivery checks before merge.

## 2026-09-10 UTC: Hub #43 proposed Nanoleaf Linux runtime

Coordinator: the Hub #43 documentation root. Hub #43 remains in progress and
blocked. Nanoleaf #54 owns source and setup; its candidate is under review in
[PR #57](https://github.com/jimmie-potts/codex-nanoleaf/pull/57) at
`4abafec1bf0054a39db3e472b15eb86f76824867`. Nanoleaf #55 owns installed,
real-client and physical-light acceptance and remains blocked by #54. The source
coordinator reports 173 Python checks plus isolated setup of the virtual
environment, Python and Node dependencies, copied Node runtime, separate
foreground map/controller/MCP processes, and authenticated Quiet/Work/Free MCP
commands using fake loopback transport. This is source-candidate evidence. It
does not mark #54 delivered and does not establish installed or physical
behavior.

Add a separate proposed Linux runtime diagram while retaining the implemented
Windows command-path diagram. The proposal keeps Python hooks, CLI, wall map and
controller as separate Ubuntu WSL processes sharing Linux SQLite. Node MCP calls
the controller at numeric loopback. The on-demand worker remains the sole light
writer; setup and the map may make bounded device reads for connection checks or
geometry. Windows Desktop and browser clients remain, with configured project,
title and unread JSON mounted read-only. The fresh installation excludes data
migration, rollback tooling, a combined daemon, a new hook API, shared monitoring
and the Nanoleaf source move.

This companion changes documentation and its generated guide, with no Hub
product behavior delta. Nanoleaf's issue-linked `gh-54-linux-fresh-install`
specifications and ADR 0007 own the runtime contract; no Hub OpenSpec change is
needed.

Refresh all three tracker snapshots and assign Hub #43, Nanoleaf #54 and #55 to
the hosting and migrations guide. Preserve the open Prism guide work in PR #82
at `d086459a529b789a3572aaaedfaf9cf6f68921b4`; its coordinator still owns that
scope. This candidate reconciles the current N52, N53, N26 and H80 guide inputs
only so the refreshed snapshot retains complete coverage.

The tracker snapshot was captured at `2026-09-09T23:48:41.091564+00:00`, before
#54 moved to review and PR #57 opened; the dated update above records the later
source transition without rewriting the snapshot. The source candidate adds
local-filesystem rejection tests and platform-neutral MCP tool descriptions.
All 39 MCP tests pass. The prior source revision passed all 18 hosted checks;
GitHub refused to start CI for the current revision because of an account
payment or spending-limit problem. No current-head hosted success is claimed. The architecture review pins
Hub `2564a357ec7d1a72c5525c0f36b98287244a6e89`, Nanoleaf PR #57 head
`4abafec1bf0054a39db3e472b15eb86f76824867` and Pixoo
`7c1204fd2516df86c706bae7c9498a5ee1bb749b`. Archify passes all nine checks for
each of nine viewers. The guide builds with 12 guides, 110 primary open issues
and 44 roadmap nodes. The maintenance test and browser check pass; the browser
checked widths 320 through 1440, diagram navigation, links, search, print state
and external requests. The new viewer's separate Archify browser check passes
at 1440x900 through 2048x1320. Agent inspection covered desktop, mobile and print
captures. The existing work-guide user exemption recorded in
[Hub PR #76](https://github.com/jimmie-potts/agent-device-hub/pull/76) and retained
in [Hub PR #79](https://github.com/jimmie-potts/agent-device-hub/pull/79) removes
only human approval for this document. Independent review, hosted CI, merge,
public publication and installed acceptance remain pending.

## 2026-09-09 UTC: Hub #80 public guide hosting

Coordinator: the public-guide delivery root. The user selected public access.
GitHub rejected Pages creation on the private hub repository because the current
plan does not support it. Use the public `jimmie-potts/agent-device-guide`
repository for the generated guide and eight companion viewers, with the hub
remaining the source of maintained inputs and generated output.

Add the public guide link and the publication procedure to the guide README.
The source snapshot is hub revision
`8064537639d7a91a66657cdbce9a63654e41b80c`, guide SHA-256
`3004c48ff75f3cc54b59735da3bd71071d2c178f41ef6d15b4d898229473c7c3`.
Regeneration is byte-identical. No represented product, backlog, architecture,
history or acceptance fact changes; preserve their existing snapshot dates.
There is no product behavior delta or OpenSpec change. Hub #73's reserved
diagram repair remains separate.

Candidate validation, both PR links, independent reviews, CI and the public
deployment readback belong in the delivery receipt. This entry records the
publication candidate; successful deployment must be verified separately.

## 2026-09-09 UTC: Pixoo #12 approved acceptance and timing follow-up

Coordinator: the Pixoo #12 delivery root. The owner approved moving only effective
variable GIF timing to Pixoo #55. The uniform-500-ms application profile stays
unchanged. The ambiguous A/B/control observations, approximate out-of-tolerance
still reading, accepted flashing defect #52 and screen-retention limitation remain
in the dated hardware evidence. No further visual test is part of closeout.

Pixoo PR #54 merged at `7c1204fd2516df86c706bae7c9498a5ee1bb749b`
after independent Standards and Specification reviews and all five PR jobs passed.
All five merged-main jobs passed in run `34294175210` before #12 was closed as
completed at 00:17:43 UTC on September 9. Source and scoped physical acceptance
are complete; this companion reconciles the final guide status.

This companion follows the earlier evidence checkpoint in hub PR #78. Refresh
all three backlogs and histories, retain closed baselines as references, move
variable timing into the Pixoo media guide and reconcile roadmap membership.
The completed local-acceptance guide now owns zero open issues. The browser
check initially treated its empty membership as one blank ID; normalize empty
membership while retaining exact coverage assertions. The next browser run
exposed a repository-filter error on the same empty node; handle its empty
repository set and omit the empty prefix in its roadmap count. Preserve node positions, connector routing,
architecture sources and the eight viewers. Hub #73's reserved evaluation input remains revision
`7464b9e669c7150f780b334a3429c5f30a89b438`, HTML SHA-256
`8385675bb5dc6801de4c5f99e377caea2d281a2102ab6ce75b265bbac4cea6b3`.
No product behavior or OpenSpec delta applies. The existing user exemption for
this work-guide document removes only human approval; independent reviews,
all configured CI jobs and guarded merges remain required. Candidate validation
and the companion PR link belong in the delivery receipt.

## 2026-09-08: Pixoo #12 physical evidence and open timing qualification

Coordinator: the Pixoo #12 delivery root. The owner confirmed controls, recovery
and continued alternation through a 60-minute, 119-transition soak, with only
accepted flashing defect #52. Screen-on returning native GIFs is a separately
accepted limitation; explicit Resume restored the selected still. The variable
timing experiment did not establish asymmetric visible timing, and the application
retains its uniform-500-ms profile. The owner paused further visual testing.
Issue #12 remains open; draft Pixoo PR #54 contains the compatibility fix and
dated evidence. No acceptance deferral, source merge or installation is claimed.

Reconcile the guide onto the Pixoo #29 companion baseline, refresh the three
backlogs and update local acceptance guidance. Preserve history, architecture
evidence, roadmap geometry and the reserved Hub #73 input. Correct the singular
issue label found during browser inspection. This is documentation synchronization
without a product behavior or OpenSpec change. Candidate validation and the
linked companion PR belong in the delivery receipt; synchronization remains
pending until that PR merges.

## 2026-09-08: Pixoo #29 contract adoption companion

Pixoo #29 source merged in Pixoo PR #53 at
`459968ef11a8fb4558b3c76411e14d4564d6929f`. All five merged-main jobs passed
in run 34286521529 before the issue was closed as completed. The released
lifecycle archive and source/hash receipt are pinned; all 81 upstream cases
pass through its installed validator. Consumer documents define source
requirements while runtime state, embedding, UI and devices remain future work.

This Hub companion refreshes all three repository backlogs and histories,
retains P29 as a closed reference, removes it from remaining-work coverage and
roadmap membership, and updates the shared Codex narrative and recommendation.
Hub #30's current in-progress/blocked state remains explicit; its early budgets
are not delivered. No product behavior or OpenSpec delta applies here.

A new history caption records Pixoo PR #53. Roadmap geometry, connector routing,
architecture definitions and companion viewers are unchanged. Hub #73 remains
reserved at revision `7464b9e669c7150f780b334a3429c5f30a89b438` and HTML
SHA-256 `8385675bb5dc6801de4c5f99e377caea2d281a2102ab6ce75b265bbac4cea6b3`.
The user exempts this work-guide document from human approval; independent
reviews, CI and guarded merges remain required. Validation belongs in the PR.

## 2026-09-08: Hub #2 source closure reconciliation

Hub #2 source merged in PR #74 at `855bd3787803dad7245f29e88c758659f6e4eda4`.
All twelve merged-main CI jobs passed in run 34283142367. Lifecycle contract
1.0.0 has a released archive, checksum and source receipt; a fresh download
passed all manifest hashes. GitHub records #2 as completed. Its automatic closure
at merge preceded main-CI readback because completion prose accidentally used a
closing keyword. The coordinator verified the remaining gates before releasing
any dependent implementation.

Refresh the three repository histories and backlogs from paginated GitHub reads.
Retain closed #2 as a referenced source baseline, remove it from open coverage
and roadmap membership, and update the shared Codex guidance and next-work
recommendation for early measured budgets and Pixoo contract adoption. This
is guide synchronization with no new product behavior or OpenSpec delta.

Add PR #74's lifecycle-contract history caption. Preserve roadmap coordinates,
edges, connector routing, architecture definitions and companion viewers. Hub
#73 remains reserved at revision `7464b9e669c7150f780b334a3429c5f30a89b438`,
HTML SHA-256 `8385675bb5dc6801de4c5f99e377caea2d281a2102ab6ce75b265bbac4cea6b3`.
The refreshed history and membership do not replace that evaluation input.
Validation and current-candidate human approval are recorded in this follow-up PR.

## 2026-09-08: Hub #2 lifecycle contract candidate

Coordinator: the Hub #2 prerequisite-batch root. Update the shared Codex section
for the source candidate, refresh live backlogs and reconcile primary/roadmap
coverage. Add Hub #73 as reserved guide repair and Pixoo #52 as the separately
owned GIF handoff defect. Reflect Nanoleaf #34's verified completed acceptance
and retain its scoped CI exception. Current Hub/Pixoo main reruns passed; every
new candidate still needs its own checks. Product history retains its explicitly
dated earlier snapshot; no future merge or closure is predicted.

The roadmap changes issue membership and one node label. Node positions, edges,
connector routing, the eight architecture definitions and companion viewers
remain unchanged. The contract introduces no runtime ownership or command-flow
change requiring new architecture diagrams. The pinned Hub #73 revision
`7464b9e669c7150f780b334a3429c5f30a89b438` and HTML SHA-256
`8385675bb5dc6801de4c5f99e377caea2d281a2102ab6ce75b265bbac4cea6b3`
remain the evaluation input; regenerated guide data is not a replacement.

The build, maintenance test and browser check pass for 12 guides, 107 primary
open issues, 38 roadmap nodes and eight companion viewers. Chromium 149.0.7827.55
checked widths 320-1440, navigation, filtering, zoom, viewers and print/PDF state
restoration. Revision/hash and visual-review evidence belong in the PR receipt.
Human UI approval and post-merge status reconciliation remain delivery gates.

## 2026-09-08: repository adoption candidate

Repository: agent-device-hub. Move the existing three-project guide, generator,
diagram definitions and evidence inputs into `docs/work-guide`. Add the SDLC
maintenance procedure and PR completion check. The existing backlog, product
history, architecture and acceptance claims are unchanged. This entry records a
candidate; merge and independent review are pending. Validation is recorded in
the adoption PR and final delivery report.

Independent Standards and Specification reviews identified a build failure when
new history heads differed from pinned architecture sources. Removed that
coupling and the unconditional current-head claim. The offline regression test
failed before the fix and passed after it. Product facts and snapshot dates
remain unchanged. Companion PRs: Hub #72, Nanoleaf #51, Pixoo #51.
## 2026-09-09: Pixoo #46 source completion and guide reconciliation

[Pixoo #46](https://github.com/jimmie-potts/divoom-app-upgrade/issues/46) completed
through [PR #57](https://github.com/jimmie-potts/divoom-app-upgrade/pull/57) at
`9601b60935515f4ecf5f79f1b1ab59299dd1c3de`. Both independent review axes passed.
All five current-head PR jobs and all five merged-main jobs passed in runs
[34431920469](https://github.com/jimmie-potts/divoom-app-upgrade/actions/runs/34431920469)
and [34432344852](https://github.com/jimmie-potts/divoom-app-upgrade/actions/runs/34432344852).
The guarded squash merge preserved the reviewed tree. The issue was then closed
as completed and its status/blocked labels removed. Earlier account restrictions
did not prevent this candidate's hosted checks from executing successfully.

The workflow now checks pushes to main, groups obsolete revisions of each PR
for cancellation, and sets ten-minute limits while preserving all five jobs and
commands. Live cancellation was not observed because no natural overlapping
revisions occurred; no timeout was deliberately induced. There is no product
specification delta, installation or physical-device acceptance in this work.

Refresh paginated backlog and history inputs, remove completed #46 from primary
coverage and remaining roadmap issues, and record its result in Development
workflow. The snapshot also brings nine previously unrepresented open issues
into existing guide sections: Hub #80/#83/#85–#87 and Nanoleaf #52–#55. Those
records remain planned work; this refresh implements none of them. Preserve
other coordinators' open PRs and their separate source/acceptance claims.

No architecture component, ownership or command-flow changes apply. Keep the
architecture source pins, review dates, viewer bytes and connector behavior;
update only the dated history, roadmap labels/membership, narrative and backlog.
The history title now describes the snapshot instead of ending on September 8.
The delivery coordinator owns [Hub PR #89](https://github.com/jimmie-potts/agent-device-hub/pull/89),
which carries this reconciliation. Guide synchronization remains pending until
that companion merges. Public publication is not authorized by this source-only
maintenance request; the existing public edition will retain its earlier bytes.

Validation: generator, maintenance test, browser coverage/navigation/search/
links/print checks at six viewport widths, and whitespace checks pass. The final
revision, guide hash and independent review/CI results belong in the PR receipt.

## 2026-09-10: Replan Hub #30 and PR #77 for the Linux hook

The early-stage plan now measures the real Linux hook from delivered Nanoleaf
PR #57. Native Windows comparison and executable forwarding no longer block it.
Keep repeated 1/10/50 synthetic-session profiles, real Linux worker-spawn cost,
confinement and detached-child cleanup, and reviewed numeric budgets. Historical
admission/validator receipts remain unchanged; no new hook measurements are
claimed. Current CI and shared-policy Windows elements are flagged for separate
cleanup, not removed in this planning update.

The planning coordinator owns the current-main guide companion
[Hub PR #99](https://github.com/jimmie-potts/agent-device-hub/pull/99). It refreshes
affected inputs and generated output without replacing the newer Linux diagrams
with this branch's older guide. Source synchronization is pending that companion's
reviewed merge. Architecture already depicts the delivered Linux command path;
measurement replanning changes no device owner, transport or failure boundary.
Public publication and live verification are outside this request.

Node 24 setup, workflow validation and ten workflow tests passed for the planning
candidate: three current specifications, one active change and three archives.
This change remains active, PR #77 remains draft and #30 stays open for later
integrated qualification. No benchmark, runtime, CI, installation or device
operation was performed by this replan.

## 2026-09-10: Linux-only performance replan for Hub #30 and PR #77

This planning coordinator updated Hub #30 and PR #77's existing early-stage
OpenSpec artifacts to target the source-delivered Nanoleaf Linux hook. Native
Windows comparison and executable forwarding no longer gate the measurements.
The planned 1/10/50 synthetic-session profiles retain full hook return, real
Linux worker-spawn handoff, verified isolation/descendant cleanup and reviewed
budgets. Existing receipts remain historical preparation. No benchmarks,
measurement implementation, CI changes, installation or device work occurred.

This companion uses current main so PR #77's older guide does not replace the
delivered Linux architecture. Updated the qualification/budget narrative and
refreshed paginated backlog inputs. Reconciled observed Hub #54 closure out of
primary/roadmap coverage while retaining its reference, without claiming adapter
acceptance. Corrected the refreshed PC-lighting row to record PR #59's source
merge while #50 remains open. Dependency relationships are unchanged by this
replan. The history snapshot retains its own date; no new product milestone is
claimed. The guide represents 106 primary open issues in 12 guides and 48 roadmap
nodes. Its 65 historical merges retain their existing evidence date.

Architecture no-impact: the delivered Linux ownership and command path already
appear in the nine diagrams; changing performance qualification does not alter
that path. Definitions, source pins, receipts and viewers remain unchanged.
Windows CI, shared policy wording and legacy source references remain for the
separate Linux-only cleanup and must be brought to the user. They are not
required performance routes in #30/#77.

Guide generation, five maintenance tests, Node 24 workflow checks and browser
checks cover this candidate. Source synchronization remains pending this
companion's reviewed merge. Public publication and live verification are outside
the authorized planning scope. #77 remains draft and #30 remains open; this
replan does not satisfy the early budget gate or authorize OpenSpec archive.

## 2026-09-10: Linux hook baseline delivery candidate for #30 / #77

The delivery coordinator folded PR #99's planning guide changes into #77 after
reconciling current main. The candidate contains 9,000 real Linux hook calls
across nine successful profiles, bounded namespace/descendant checks and numeric
budget definitions. The guide records candidate evidence and the remaining
review/merge/CI gates. Overall #30 remains open for integrated qualification.

Refreshed the full paginated backlog after the delivery-authority update and
regenerated the guide. Architecture has no new ownership or command flow; the
nine existing Linux viewers remain unchanged. Current Windows CI and provider
support wording remain separate cleanup work. The benchmark is local-only; CI
adds one short Linux correctness step and retains its existing jobs.

Guide-source synchronization awaits #77's reviewed merge. PR #99 is superseded
as a planning companion. Record source merge history and any changed issue
status in a follow-up after authoritative readback. Public publication and live
verification remain outside this request. This entry does not assert a source
merge, installed-client compatibility, shared-feed completion or physical results.

Candidate validation: generator and five maintenance tests pass. Browser checks
pass at 320, 390, 768, 900, 1000 and 1440 pixels with no errors; 106 primary open
issues, 12 guides, 48 roadmap nodes and nine viewers remain represented.
The refresh helper now retains closed Hub #54 as a reference so subsequent
refreshes do not break its existing guide link; it is not counted as open or
accepted adapter work.

Final source review and all 13 hosted checks passed at d3d17e4. The early
performance specification was synchronized and archived after successful current
lookups. This artifact closeout changes no fact represented in the guide: its
candidate evidence and pending merge gates remain accurate. The generated HTML
is unchanged, so the existing UI approval request still identifies this candidate.
Final artifact reviews and CI must pass before merge.

## 2026-09-11: Compress #77 benchmark evidence

Compressed all six raw receipts without changing their decompressed bytes and
archived the four historical or excluded runs within Git. Added a readable
summary and checksum index; updated evidence links while preserving the consumer
package files, measurement results and budgets. This storage-only change adds no
product behavior or specification requirement, so no new OpenSpec change is
needed.

Guide no-impact: inspected guide inputs and found no raw receipt filename links.
Storage changes do not alter represented results, architecture or delivery status.
Generated HTML, snapshot dates and its pending approval remain unchanged. This
entry records evidence maintenance, not source merge or public publication.

## 2026-09-20: Pixoo #30 source qualification candidate

The Pixoo #30 candidate adds an offline-default synthetic dashboard runner,
bounded latest-picture delivery, exact RGB browser previews and local target
lock participation for both protocol tools. The shared monitoring sequence now
distinguishes this source work from the pending physical transport decision.
No device was operated; source delivery does not select a measured cadence.

Refreshed the GitHub backlog through the maintained helper. The snapshot also
observed Hub #103 closed after PR #104; retained it as a closed reference and
removed its open-work coverage. That reconciliation prevents stale atlas work
from remaining in the roadmap. Architecture ownership and command-flow diagrams
remain unchanged: this is an opt-in qualification tool, not a monitor runtime.
No product specification delta applies to this guide-only companion.

Validation receipts and source/guide PR links belong in the companion PR.
Public publication and live-site verification are outside this delivery.

Pixoo PR #59 remains unmerged at `893009145a457f3445b88b8f3df2c809cd06b388`.
All local checks and both independent source reviews passed, but the Windows
application job timed out in the existing media-admission cancellation test on
the initial attempt and its single retry. The other four jobs passed. The guide
records this blocker and pending physical acceptance; it does not claim source
completion. The refreshed history also records the observed #104/#109 merges.

## September 20, 2026: Pixoo #30 cancellation-test correction

The coordinator diagnosed the Windows CI timeout as a circular wait in the
media-admission test. PR #59 now holds the existing shared manual clock and
releases its gated import during cleanup. The real queue, cancellation and
session-retention assertions remain. No production behavior or specification
delta changed. The branch also incorporates the merged controller API from
PR #58 and retains both ADR entries.

Guide reconciliation updates the shared-monitoring qualification row, backlog
metadata and paginated delivery history. Architecture ownership and all nine
viewers remain unchanged. Physical measurements, method/cadence selection,
installation and public guide publication are not performed by this update.

The refreshed backlog also observes the owner-created Pixoo #61 hardening
story. Added its primary coverage and corrected the obsolete statement that
numeric performance acceptance blocks #31. This records the saved issue scope;
it starts no work on #31 or #61 and changes no performance limit.

Pixoo PR #59 merged as `df9c37d836df78ecd7e26d4fa2c2934b829055e6`
after all five current-head jobs passed and both independent reviewers approved
`6a424e3298adf19a756745208d5f3606e23fc37b`. Local checks passed 533
application tests, 10 workflow fixtures and 54 browser tests. The merged source
tree matches the reviewed candidate. The linked delivery receipt records
merged-main CI separately. Issue #30 remains open for physical measurements and the method/cadence decision.


## 2026-09-21 — Hub #6 dashboard candidate

The issue is in review in PR #127 after its three source prerequisites closed. The
candidate adds the shared React/TypeScript integration frontend using the current
approved Nanoleaf Prism/Neon visual language, typed owning-controller commands,
scoped context and a third synthetic component fixture. The user approved the
source UI candidate. Independent final review, renewed hosted CI and source
merge remain pending.

Refreshed backlog inputs and regenerated the shared Codex guide. Preserved the
merged Hub #5 reconciliation. Existing architecture diagrams retain their planned
dashboard designation because #6 is not source-delivered; no diagram flow or
ownership claim changes at this checkpoint. Installation, physical acceptance
and public guide publication remain separate. Validation is recorded with the
candidate's delivery evidence.

## September 21, 2026: Pixoo #34 source packaging candidate

The Pixoo #34 delivery coordinator prepared shared setup package reuse,
disposable simulator rehearsal and the operator acceptance sequence. Refreshed
the backlog and remaining-work narrative to show source work in progress while
retaining installation, required-client, Nanoleaf coexistence/cutover, physical
and Hub #6 frontend gates. The issue remains open and blocked. No source merge
or live acceptance is predicted. Architecture ownership and command flow remain
as documented for Hub #8; no diagram redraw is needed. Public publication is
outside this delivery. Candidate generation, maintenance and browser checks
are recorded in the companion PR.

### Source merge reconciliation

Pixoo PR #65 merged as `37031be56007b6b890ec7a2098aa6e283d9d01fa` after both
independent reviews and all five PR jobs passed. Its tree matches the reviewed
candidate; merged-main CI is recorded separately in the delivery PR. Issue #34
remains open for installation, required-client and physical acceptance. Hub #6
closed during this delivery after PR #127, so its source prerequisite is now
available; the installed frontend trial still needs authorization.

Refreshed paginated repository history and issue inputs, retained Hub #6 as a
closed reference, and removed it from remaining-work coverage and roadmap
counts. The initial refresh correctly failed coverage until that reconciliation.
Generation, five maintenance tests, browser/print checks and output consistency
pass for the reconciled candidate. Architecture viewers retain their dated
source pins and proposal labels; this status reconciliation does not redraw them
or claim installation. Public publication remains pending separate authority.

## 2026-09-21 — Nanoleaf #30 personal installation

The owner replaced formal migration/rollback acceptance with a one-off Linux/WSL
update and basic real Codex Desktop/CLI-to-light checks. A reusable updater,
Windows/Claude qualification, the shared frontend and integrated performance
qualification no longer gate this issue. Their separate work is not marked done.

The owner ran the prepared update from an ordinary WSL terminal. The installed
bridge matches Nanoleaf `f12ac6653a9f3267fa9ef62a2d6667072183d8b3`;
all three existing services restarted. Hub source
`f6bee907e06177c6dc8abde0075d73cc391784e9` was packaged and installed,
its monitor service started, and Nanoleaf reported shared input with a current
feed and Work mode. All 65 installed Hub manifest entries match their hashes.
Both exact real-client test tasks reached the shared host and Nanoleaf with
turn-ended notices and matching identity sets, without duplicate identities.
The Desktop retry passed after the owner trusted its new hooks. Shared selection
survived restart of all four services. The owner reported completed tasks and
light color changes. Quiet, Free and Work each returned confirmed transmission
with no uncertain operations, ending in Work. No separate optical claim is made
for each mode. The wall map returned HTTP 200 and rendered its SVG without page
errors. The Desktop backend was 0.155.0-alpha.9.2; the GUI About build was not
reported.

The task terminal cannot access the user service manager or write a real Codex
CLI session; the owner runs those commands in the ordinary WSL terminal.
The native Codex CLI is 0.153.4. Source checks were reused from the delivery
record: 231 Nanoleaf tests, 18 setup tests and isolated cross-consumer checks.

Updated the shared-integration row and refreshed backlog inputs. Architecture
contracts and diagram ownership are unchanged. Public publication and live
public-guide verification are separate and were not performed. Local guide
validation and the companion PR reviews are recorded with this candidate.

Nanoleaf #30 is now closed with all five reduced acceptance criteria checked.
The owner also added Pixoo with new-turn clearing and a dedicated private
read/control credential. Saved consumers were reconciled, and authenticated
read/control checks passed. Pixoo device acceptance remains separate.
The refresh retains #30 as a direct closed reference without importing private
operational comment bodies. Acceptance receipt: https://github.com/jimmie-potts/codex-nanoleaf/issues/30#issuecomment-5769876793.


## 2026-09-22 - Hub #137 current-status candidate

Prepared best-effort current-turn selection in the shared reducer, agent-state
2.0.0 and Hub 0.2.0, with unchanged snapshot/storage 1.0. The candidate guide
records the delayed-unseen-start limit, old-store recovery, independent consumer
policies and the separate installed Pixoo #34 retest. Reset #138 and history #139
remain separate work. No hooks, personal service, state store or device changed.

Refreshed all three backlogs after incorporating PRs #135, #136, #140 and the #145 closure refresh.
The closed issues #9, #30 and #63 remain reference links and leave open-work counts. Retained the added status/recovery/history roadmap tracks.
The change affects reduction inside the existing state owner; no architecture
component, ownership arrow, transport or physical writer changes, so diagram
source pins and viewers remain unchanged.

Generation, five maintenance tests and desktop/mobile/print browser checks pass.
The candidate has 93 primary open issues, 12 guides and nine architecture viewers.
Final source reviews, hosted CI, merge and immutable release receipts follow this
candidate. A linked completion refresh will record facts unavailable before
merge. Public guide publication and installed verification remain separate.
## 2026-09-22 — Hub #9 bounded source compatibility candidate

The Hub #9 coordinator synchronized the owner-approved scope reduction and current
in-progress state. The shared-monitoring guide now separates #9's small everyday
compatibility suite from #30's performance qualification. It retains #30's report
as a completion input and keeps installed-client and visible-device acceptance
with their owners. Refreshed backlog inputs retain current source receipts;
no architecture ownership or command flow changed, so diagram sources are unchanged.

Guide generation, five maintenance tests and browser/print checks passed. The
candidate HTML SHA-256 is
`16b813fe25e7c75307f7faf23cf8056219a2718e45eee7ed63169b0351e705af`.
This entry records an unmerged source candidate. Public publication and live
verification are outside this delivery and remain separate.

## 2026-09-22 - Hub #137 source and release completion

Reconciled [source PR #144](https://github.com/jimmie-potts/agent-device-hub/pull/144)
at `013b829a851277cd0cfbaeaba6d6d0dfc32727c7`, the verified agent-state 2.0.0
and Hub 0.2.0 releases, and the completed eight-item issue checklist. The merged
tree matches reviewed `b1eff926`. Both independent reviews, all six PR jobs and
all six merged-main jobs passed. Fresh source builds and both CI Python jobs
reproduce the released archive hashes; all downloaded assets match their
prepared bytes. Release assets include checksums and merged-source receipts.

GitHub recorded issue closure at merge time. Main checks and release publication
were subsequently verified before the coordinator completed the checklist and
removed the review label. This entry records those stages separately.

Updated the shared-monitoring guide, Pixoo #34 handoff and status/recovery track.
Retained #137 as a closed reference, removed it from open-work coverage, and
refreshed all three backlogs plus paginated repository history. There are 92
primary open issues, 12 guides, nine viewers, 52 roadmap nodes and 113 merged PRs
in this snapshot. Reset #138 and reliable history #139 remain separate work.
The policy stays inside the existing state reducer, so ownership, transports,
physical writers and pinned architecture viewers do not change.

Guide generation, five maintenance tests, desktop/mobile/print browser checks
and generated-output consistency pass. HTML SHA-256:
`9595ae1cfe67fa2fd3f1743ead4b862c8aa17fad118165846c461908f1c0af69`.
This follow-up changes only `docs/work-guide/**`; the unchanged workflow path
filters intentionally omit hosted checks and require the SDLC exception receipt.
No new product behavior or OpenSpec delta is introduced.

Public guide publication, installation and the real Desktop/Pixoo retest remain
separate. The public readback still serves Hub source `2607070`, landing-page
hash `4d8f172a5025252c7b06551dfa862d1abe697fc532a54f75151d231217ed799e`.
The named installation owner follows the packaged update instructions and Pixoo
#34 for the remaining installed acceptance. This source task changes no personal
hook, live database, service or physical device.
