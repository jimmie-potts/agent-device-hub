# Guide maintenance history

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
