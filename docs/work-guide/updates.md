# Guide maintenance history

## 2026-09-10 UTC: Hub #83 approved source integration

The user approved the refreshed guide layout and its desktop, mobile and print
candidate. Reconcile later main changes without changing that layout or its
controls. Preserve the delivered core CI improvements and adopt the matching
guide-workflow scheduling from PR #82's current owner-controlled revision
`6b22b16859204c118158d326b0d2c84383ebce05`. All browser checks, artifact uploads
and job permissions remain intact. This does not edit that owner's branch or
close Hub #91 on their behalf.

Pixoo companion PR #56 merged at
`9f1c0ec75651810a441606b0c08fbdeee824c8d8`; merge-tree equality was verified.
Its main CI and the Nanoleaf companion's refreshed source gates are recorded in
the delivery receipt. Refresh current scope and history before the Hub merge,
including Nanoleaf's merged renderer/numeral sources and still-open acceptance
stories. Do not infer installed or physical acceptance from those source merges.

Architecture no-impact remains unchanged: instruction adoption, CI scheduling
and these status/history updates alter no represented device ownership, command
path or failure boundary. Preserve the eight viewers and their evidence dates.
Guarded source merges/main CI, guide synchronization, public publication and
live verification remain separately evidenced stages. The user approval here
does not itself establish public deployment.

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
