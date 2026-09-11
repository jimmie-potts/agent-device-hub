# Guide maintenance history

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
