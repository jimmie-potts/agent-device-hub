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
merge, main-CI readback and [cleanup after delivery](#cleanup-after-delivery).
Narrower user scope prevails.

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

## Work guide updates

The [cross-project work guide](work-guide/README.md) is a dated publication, not
a live delivery ledger. Refresh its saved inputs and generated output when the
authorized task intentionally updates or publishes it. An unrelated planning,
source or acceptance task does not require a guide refresh, no-impact entry,
companion PR or public-currency check. Closing such a task does not claim that
the dated guide or public edition reflects its latest state.

For an intentional guide update, follow the guide procedure and record changed
sections, snapshot time, validation and source revision in its PR. A
cross-repository update may use a linked Hub companion PR with one coordinator.
Keep source completion, guide revision, public publication and live verification
as separate claims. Publishing remains a distinct authorized step with its own
review and verification gates. Explicit `plan-work` and `deliver-work` use
their applicable checkpoints within the user's authority; ordinary work does
not implicitly invoke those skills.

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
4. Read all GitHub reviews/threads and verify the [Depot evidence](#depot-ci-evidence)
   for the current PR head. Require every applicable configured job to succeed,
   including matrix jobs; missing, pending, skipped, cancelled or failed jobs
   prevent merge except for the verified guide-only filtering described below.
   Apply the UI approval scope below.
5. Immediately recheck issue scope/dependencies, main and PR head. Refresh affected
   tests/reviews when either commit changes. Squash only the reviewed head with
   gh pr merge <number> --repo jimmie-potts/agent-device-hub --squash --match-head-commit <head>.
   Never use --admin, a background merge service or account/privacy changes.
6. Read back the main merge revision and verify its Depot evidence using the same
   rules, or record the guide-only exception evidence below. Close only the delivered
   issue after its acceptance is met, clear workflow labels and verify closure.
   Do not close future implementation or device acceptance issues with a bootstrap.
7. Clean up this delivery's own worktree and scratch as described in
   [Cleanup after delivery](#cleanup-after-delivery).

### Cleanup after delivery

Start once step 6 has confirmed that the merged revision's Depot jobs succeeded,
or recorded its guide-only exception evidence, and read back the issue state.
Cleanup does not wait for installation or physical acceptance unless that work
still uses the worktree. Clean up only what this delivery created:

1. Confirm the PR is merged and the delivery worktree's `HEAD` is the PR's
   reviewed head (`headRefOid`, the `--match-head-commit` value), not the squash
   commit on `main`. Squash merges leave a branch's commits off `main`, so judge
   delivery by the PR's merged state, never by commit ancestry. Commits after
   the reviewed head are unfinished work.
2. Run `git status --short --ignored` in the worktree, and look inside the
   scratch folder. `git worktree remove` deletes ignored files, including the
   worktree's own `.local/`, test output and `node_modules/`. Move anything the
   issue still needs into the PR, the issue or the canonical local checkout's
   `.local/evidence/gh-<issue-number>-<slug>/`. The PR and issue are public, so
   private material goes only to `.local/evidence/`. Confirm the other ignored
   files are disposable.
3. In every case, clean up the canonical local checkout's
   `.local/scratch/gh-<issue-number>-<slug>/` folder: remove each worktree
   registered inside it with ordinary `git worktree remove`, confirm that
   `git worktree list` shows none there, then delete the folder. Step 1's `HEAD`
   check applies only to the delivery worktree.
4. For a delivery worktree created with `git worktree add`, run
   `git worktree remove <path>` from the canonical local checkout and confirm
   with `git worktree list` that the path is gone. Do not delete the delivery
   branch yourself.
5. Leave a tool-managed worktree, such as a Claude Code session worktree under
   `.claude/worktrees/`, to that tool's own exit flow instead of
   `git worktree remove`; that flow may also delete its branch. Once steps 1 and
   2 pass on a clean worktree, accepting the tool's option to discard the
   squash-merged commits is allowed. If this session cannot run that flow, keep
   the worktree and report it as ready to remove.

Keep the worktree and scratch, and report the path and reason, when a worktree
is dirty or locked, another process or session uses it, the delivery worktree's
`HEAD` differs from the reviewed head, evidence is not yet preserved, an ignored
file is not confirmed disposable, or `git worktree remove` refuses. Without the
user's explicit approval, never force removal or reset, clean or discard files
to make a worktree removable. If main CI fails, or the work failed or was
abandoned, ask the user whether to keep or remove it and keep it until they
decide. Leave other sessions' worktrees, branches and scratch alone.

### Depot CI evidence

For routine merges and merged-main verification, successful GitHub check-run
records from Depot are sufficient; opening every successful job page is not
required. Enumerate expected jobs from the candidate's `.depot/workflows/`
configuration, including matrix expansions and applicable branch/ruleset
requirements. An overall green PR indicator or an empty protection list does
not establish that the expected jobs ran.

Read all pages of check runs and relevant annotations. Verify each required
result is `completed` with conclusion `success`, has the exact candidate or
merged-main SHA, belongs to this repository and the expected PR or main event,
and comes from the expected Depot GitHub App (`depot-code-access`). Retain job
names, check IDs, revision and details URLs in delivery evidence. Resolve
superseded attempts and contradictory results before accepting a successful
rerun. Historical GitHub Actions runs and checks from another app or revision
do not qualify.

Inspect relevant Depot job details, logs or artifacts when a job fails, results
conflict, a job is missing or unexpectedly skipped, workflow changes leave actual
coverage uncertain, or acceptance requires evidence beyond a success status.
Use the [diagnostic access procedure](development.md#depot-diagnostic-access).
If required diagnostic evidence is unavailable, report that gap and keep the
merge or completion gate pending. A dashboard sign-in requirement alone does
not block routine delivery whose check-run evidence is complete. Preserve the
separate guide-only exception, independent reviews, head guard and post-merge
verification.

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
