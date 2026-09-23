# Development workflow

## Authority and preparation

GitHub issues own requested outcomes, acceptance criteria, dependencies, status
and delivery targets. OpenSpec owns reviewed capability scenarios and proposed
deltas. Architecture/ADRs own lasting decisions. PRs own candidate revisions,
reviews and CI evidence. Link to those sources instead of copying status ledgers.

Planning/review stays read-only unless the user explicitly authorizes document or
tracker writes. Those writes authorize their named artifacts, not future runtime
implementation. A normal implementation or maintenance request includes issue
updates, isolated work, validation, PR publication, independent review, eligible
merge and main-CI readback. Narrower user scope prevails.

Reuse existing issues. Record dependencies as full cross-repository links and
GitHub native blocked-by relationships where supported. Distinguish required
source prerequisites, conditional physical gates and related independent work.
Check for cycles when changing ownership or prerequisites.

Use enhancement, documentation, maintenance, hardware and deferred as descriptive
labels. Each open delivery issue has one of status:backlog, status:ready,
status:in-progress or status:review. Add blocked with its dependency/decision and
next action when applicable. Remove workflow status/blocked labels on closure.

## Scope and implementation

Follow this workflow for authorized delivery. Select code-review for review,
writing-for-agents for instructions, grill-with-docs for unsettled
implementation-changing decisions, and tdd for meaningful executable behavior.
Use installed central methods; missing prerequisites are reported without local
copies or silent replacement.

Use the shared deliver-work skill only when the user names it; ordinary delivery
follows this document. Both paths retain independent reviews, CI, guarded merge,
issue readback and installation authority.

Refresh the repository-defined main, inspect worktrees and create
codex/gh-<issue-number>-<slug> in an isolated worktree. One coordinator owns
repository/GitHub writes. Reviewers are independent and read-only. Preserve
other sessions' worktrees, branches, installations and ownership.

New Tidbyt and LIFX work belongs in this monorepo under their scoped controller
instructions. Assign one writer per deliverable and a coordinator for changes
to shared contracts, root manifests/lockfile and CI. Merge shared prerequisites
before dependent work claims compatibility. A controller change validates its
affected consumers; shared changes validate every affected controller.
Existing Pixoo/Nanoleaf repository moves remain separate deferred issues.

Features/changed contracts need an exact issue-linked OpenSpec proposal,
capability deltas and tasks. Timing, concurrency, migration, installation and
significant design changes also need applicable design/failure/recovery work.
Documentation/tooling with no product behavior delta needs an issue/PR and a
recorded explanation, without invented product specs.

Use npm run openspec -- <arguments> from the assigned root and an exact
gh-<issue-number>-<slug> change under openspec/changes. Inspect active and archived
names before creation. Initialize with init --tools none --profile core --no-animation.
Evaluate conditional design omission against the schema and record its reason.

Before product implementation, define proportionate executable tests and build/
type checks in docs/development.md and CI. Use a meaningful failing scenario
before its fix; imported bootstrap workflow fixtures do not establish a product
red/green result. Do not widen scope to satisfy a test or rewrite device behavior
as incidental cleanup.

## Work guide completion gate

Every authorized delivery includes review of the [cross-project work guide](work-guide/README.md).
Explicit `plan-work` and `deliver-work` use its planning, candidate, completion
and publication checkpoints. Ordinary work follows the same project procedure
without implicitly invoking these skills. Retain tracker-only, read-only and
source-only limits; existing publication authority needs no repeated approval.
Follow its maintenance procedure, update affected inputs and generated output,
and record the outcome in `docs/work-guide/updates.md`. The PR must name changed
sections and validation, or give a specific no-impact reason. Cross-repository
delivery requires a linked hub companion PR and explicit synchronization status.
Guide status must follow verified source evidence, including any post-merge
reconciliation. Missing updates prevent a claim of fully completed delivery.
Report guide-source synchronization, public artifact publication and live
verification as separate stages, with evidence or a pending owner/next action.
Check public currency even when this source change has no guide impact. A Hub
merge is not evidence of a current public edition.

## Review and merge

1. Complete authorized changes, relevant checks and applicable OpenSpec artifacts.
   Obtain successful current sync/archive lookups; synchronize every affected spec
   and archive on the delivery branch before final review. Incomplete tasks,
   missing acceptance or failed lookups prevent archive.
2. Commit the candidate and open a PR with Refs #<issue>. Record base, head,
   merge-base, diff command, clean worktree and validation. Avoid automatic issue
   closure before merged-revision CI.
3. Obtain independent read-only Standards and Specification reviews of the same
   fixed comparison through code-review. Fix P0-P2 findings; record lower-priority
   dispositions and reassess changed candidates. Self-review cannot authorize merge.
4. Read all GitHub reviews/threads and current-head Depot CI checks and job pages.
   Require every applicable configured Depot job to succeed, including matrix
   jobs; missing, pending, skipped, cancelled or failed jobs prevent merge except
   for the verified guide-only filtering described below. Disabled GitHub Actions
   workflows and their historical billing-blocked runs do not qualify or replace
   Depot evidence. Apply the UI approval scope below.
5. Immediately recheck issue scope/dependencies, main and PR head. Refresh affected
   tests/reviews when either commit changes. Squash only the reviewed head with
   gh pr merge <number> --repo jimmie-potts/agent-device-hub --squash --match-head-commit <head>.
   Never use --admin, a background merge service or account/privacy changes.
6. Read back the main merge revision and all applicable Depot CI jobs, or record the
   guide-only exception evidence below. Close only the delivered
   issue after its acceptance is met, clear workflow labels and verify closure.
   Do not close future implementation or device acceptance issues with a bootstrap.

### UI approval scope

UI changes to the cross-project work guide maintained under `docs/work-guide/`
do not require human approval. This includes its layout, styling, navigation,
interactions, generated HTML and companion architecture viewers. Publishing
verified copies of these guide artifacts adds no human UI approval gate;
publication still requires the authority and evidence in the
[guide procedure](work-guide/README.md#publish-the-public-edition).

All other UI changes require explicit human approval of the current candidate,
renewed after further changes to that UI. A PR containing both guide and other
UI changes still needs approval for the other UI. Guide changes alone do not
invalidate approval of otherwise unchanged UI.

Record the affected UI and either its guide exemption or current-candidate
approval in the PR. For guide work, this policy supersedes older human UI
approval wording in issues and plans. Preserve their design deliverables,
validation and dependencies; reconcile the approval wording during authorized
tracker updates.

Independent Standards and Specification reviews, local guide/browser checks,
applicable CI and guarded merge remain required. Assess the guide-only CI
exception separately against every changed path. Guide UI changes accompanied
by edits outside `docs/work-guide/`, such as SDLC documentation, require normal
CI even though the guide UI needs no human approval.

### Guide-only CI exception

Both Depot workflows exclude changes entirely under `docs/work-guide/`. This includes
its generators and tests. For a guide-only PR and its main merge, the coordinator
may accept intentionally absent runs only after recording all of the following:

- The exact base/head or before/after merge revisions, the complete changed-file
  list, and the workflow triggers at the candidate revision. Use the PR's full
  comparison and the push's comparison separately; include deletions and both
  paths of renames. Every path must remain under `docs/work-guide/`.
- Successful local guide generation, generated-output consistency, maintenance
  tests and browser checks from the exact candidate using the guide procedure.
  Retain the HTML hash, screenshots, print check and verification receipt outside
  Git. Validate the merged tree and repeat checks if its guide content differs.
- Depot event/head associations and GitHub check readbacks consistent with those
  filters, plus the current protection and merge-state inspection. Missing runs
  alone, failed API reads or a cancelled run do not establish intentional filtering.

Independent Standards and Specification reviews and guarded squash merge still
apply. Follow the separate [UI approval scope](#ui-approval-scope). Required checks
that remain pending block merge; never bypass protections or emit dummy success
checks. Record unavailable protection reads and inspect the PR's authoritative
merge/check state.
Any changed path outside the guide folder requires all normal CI, including a
rename out of the folder. If path scope or filter applicability is uncertain,
retain the normal gate until resolved. Workflow/policy changes themselves receive
full CI and cannot use their proposed exception to approve their own delivery.

For issue closure and later authorized publication, the verified guide-only
receipt replaces only the absent Hub CI evidence. All other acceptance and
publication requirements remain in force. Record this distinction explicitly.

The initial GitHub-generated README commit only creates the default branch.
Subsequent bootstrap and product changes use PRs. Do not assume private-plan
branch protection is available or absent; honor configured protections and retain
these procedural gates.

## Installation and evidence

Source delivery does not install personal hooks, start a local service, launch
agent sessions, migrate live databases or operate devices. Each requires the
applicable explicit authorization and identified owner. Physical work additionally
needs an explicit IP and permission for the test sequence/content replacement.

Keep source/CI, installation, real-client, transport and visible-device evidence
separate. A fake or successful HTTP command does not establish optical results.
Preserve the owning device repository's installation and restoration rules.
