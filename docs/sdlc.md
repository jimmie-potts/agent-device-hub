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
merge, main-CI readback, applicable installation and verification under the
[installation policy](#installation-and-evidence), and
[cleanup after delivery](#cleanup-after-delivery).
Narrower user scope prevails.

Reuse existing issues. Record dependencies as full cross-repository links and
GitHub native blocked-by relationships where supported. Distinguish required
source prerequisites, conditional physical gates and related independent work.
Check for cycles when changing ownership or prerequisites.

Use enhancement, documentation, maintenance, hardware and deferred as descriptive
labels. Each open delivery issue has one of status:backlog, status:ready,
status:in-progress or status:review. Add blocked with its dependency/decision and
next action when applicable. Remove workflow status/blocked labels on closure.

## Scope defaults

This is a personal project. Size each story for how it actually runs: one
operator, the selected hub installation with the agent clients it already
supports, and the devices explicitly configured there. Add hosts, users,
services or automation only when the story needs them. These defaults never
remove an already accepted capability.

Assess scope when drafting a story, at pickup and after a material scope or
assumption change, whether or not `plan-work` or `deliver-work` was invoked.
Use the shared assessment in the installed deliver-work package's
`references/work-assessment.md`, found through the host's skill discovery.
Reading it does not invoke either skill. If it is unavailable, report that and
apply this section. Codex and Claude follow the same policy. A read-only request
reports the assessment instead of editing the issue.

At every pickup, read the current issue and dependencies, current main, the
accepted [project direction and architecture](architecture.md#product-direction-and-vocabulary),
relevant contracts/ADRs and reusable components, and related work added since
planning. Expand the original source/search boundary when current evidence
warrants it. Record the current sources and whether the issue remains aligned,
needs an implementation adjustment, is superseded, or needs an owner decision.
Reuse the existing assessment; no new dossier or benchmark is required. Routine
implementation adjustments within accepted scope may proceed. Do not silently
remove an accepted capability or change scope, acceptance, compatibility, authority
or accepted risk. In unattended work, defer that decision-dependent branch and
continue independent authorized work. A read-only assessment makes no changes.

Draft stories with the recognized detailed headings of the
[Work item template](../.github/ISSUE_TEMPLATE/feature.md), using the same headings
for maintenance and investigation issues. New stories also begin with the
[opening below](#new-story-opening). A small story may answer each detailed
prompt in a few sentences.

Use the [issue conventions](issue-conventions.md) for Epic, Work item and Bug
intake, native membership and portfolio views. Outcome and observable acceptance
are required. Implementation, preservation and deferral details are conditional
on the work; keep their recognized headings without inventing irrelevant prose.
No model choice or Execution recommendation is required to file an issue.

1. Outcome and real setup.
2. Smallest useful implementation, with dependencies.
3. Behavior and protections to preserve.
4. Observable acceptance and planned evidence, with the delivery target.
5. Meaningful deferrals, each with its consequence or manual alternative and
   its owning issue or revisit trigger.

Prefer existing components and explicit manual steps where practical. Avoid
speculative platform support, abstraction layers, automatic rollback systems and
broad outage matrices. Always protect supported behavior: one authoritative
state owner and one writer per device, correct targets, bounded queued work, no
unsafe replay, accurate freshness and completion, manual control, and user data
integrity.

Basic credential hygiene and the existing authorization and origin checks apply
to local use too. Reassess before remote or public exposure, an additional
operator or writer, expanded compatibility, or recurring failures. A change that
could lose irreplaceable data needs practical recovery evidence, using existing
facilities where possible; this is not a general backup-tooling requirement.

For each meaningful cut, name the capability or assurance lost and reconcile
dependent issues and specifications within the task's authority. Never silently
remove requested behavior; ask the user when a cut would change it. Scope
defaults keep review, CI, UI verification, OpenSpec and the source, installation and
physical boundaries, with their existing exceptions, and add no new gate.

For a consequential change to credentials, persistent state, concurrency or
device commands, define acceptance examples before implementation. Give the owner
a short walkthrough in the PR with code and test links: state and writer
ownership, timeout, restart and duplicate behavior, the important failure test,
and diagnosis and recovery. Explain any change that weakens an existing test
assertion. The walkthrough is an understanding aid, not an approval gate.

Judge these defaults from existing PR evidence: delivery time, correction rounds,
defects after merge and human effort. Unknown effort or usage stays unknown.
[agent-skills#44](https://github.com/jimmie-potts/agent-skills/issues/44) owns
the comparative evaluation; no metrics service or parallel report is required.

Example, checked on 2026-09-24 against LIFX status
([#20](https://github.com/jimmie-potts/agent-device-hub/issues/20)) and its
installed trial ([#22](https://github.com/jimmie-potts/agent-device-hub/issues/22)):

- Setup: one operator, one designated controller runner and the bulbs selected
  by explicit IP.
- Smallest implementation: consume the shared state owner's feed through #18's
  per-bulb queues. No second lifecycle reducer, cross-process lease service or
  effect engine.
- Preserve: a heartbeat or unchanged snapshot never resumes painting over a
  manual change, stale input never means done, and stop retires pending
  automation without claiming to undo a request already sent.
- Evidence: fake feed and transport tests for manual override, stale input and
  one offline bulb; #22's trial is the visual acceptance.
- Deferred: every-client compatibility and long-running reliability. A
  repeatable observed defect gets a focused follow-up.
- Limitation: this checks the issue text against the guidance. It does not show
  how an agent will apply it.

### New-story opening

For every new story created after this rule is adopted, keep the normal GitHub
issue title and start the body with a separate descriptive `##` headline followed
immediately by exactly five top-level bullets. Put this opening before the five
detailed sections and any optional origin or planning history. Apply it to new
feature, maintenance, investigation and child stories written through the GitHub
template, CLI or an agent, whether or not a shared workflow skill is invoked.

The headline itself explains the planned benefit, for example, "Change my lights
and display together." Avoid generic headings such as "In plain English,"
"Summary" or "Overview." Use one short sentence per bullet, with familiar words
and specific nouns. Choose five distinct details about actions, triggers,
responding devices, visible results or practical limits; these are writing
prompts, not mandatory labels. Keep necessary technical detail in the sections
below. Product names and essential user-facing terms may stay.

Describe planned work without claiming it is already delivered, installed or
physically verified. An investigation promises findings or a decision, not a
working feature. Preserve unresolved choices and unknowns; never invent behavior,
prerequisites or success claims to fill the five bullets. Keep the opening
visible, outside tables, code fences and collapsed details.

Preserve the five recognized detailed headings in their existing order and the
strict `## Guide` fields, plus applicable assessment and execution advice. The
opening summarizes the detailed scope, dependencies, acceptance and evidence;
it does not replace them or become a new parsed scope or readiness field.

**Future stories only.** Do not backfill, rename, reformat or otherwise edit
existing issues for this rule. Picking up or editing an existing issue does not
trigger a retrofit. A new child uses the opening; its existing parent remains
unchanged. Existing stories remain valid without it.

The GitHub chooser uses a Markdown template so the author's headline can appear
first at level two. YAML forms add fixed field headings and cannot substitute
an answer as the headline. The Work item template retains the labels, recognized detailed headings and
Guide guidance; Markdown does not enforce required inputs.
Complete outcome and acceptance, fill the other detailed sections when relevant,
and replace all opening prompts before filing.
For CLI or agent-created issues, write the same structure directly without
frontmatter or template comments. No live test issue or existing-story rewrite
is needed to demonstrate the format.

Reading check: can the owner read only the headline and five bullets, then
explain what the story will do without opening another issue? Check that each
bullet agrees with the detailed scope and preserves uncertainty. Use the
centrally installed `unslop` skill for the final editorial pass, as required by
`AGENTS.md`.

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
repository/GitHub writes. Standards and Specification reviewers are independent
and read-only. An Acceptance reviewer is independent and limited to the
authority in [Acceptance review](#acceptance-review). Preserve
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
a live delivery ledger; a successful browser read of GitHub can show a story's
current topic placement, note and highlight for that repository, but topic
prose, history and the roadmap stay dated regardless. Refresh its saved inputs and generated output when the
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

## Tracker reconciliation

At accepted child completion, reopening, material scope or prerequisite change,
and ownership handoff, the task's coordinating writer reads and applies the
[native issue procedure](tracker-reconciliation.md) before the final closeout
report. This applies to ordinary Codex and Claude work whether or not a shared
workflow skill is invoked.

Read-only work reports discrepancies without writing. Tracker-only work stays
within the named records and sections. Normal authorized delivery includes
routine reconciliation of affected trackers under this repository's existing
authority; narrower user scope prevails. The checkpoint grants no additional
installation, device, publication, Project configuration or cross-repository
policy-write authority.

At authorized planning, implementation, review and closeout checkpoints, follow
[Project maintenance](project-maintenance.md) for selected Project items. Run the
native checkpoint before projecting its resulting state. Project synchronization
failure remains a reported tracker gap; it does not erase verified source delivery.

## Shared manual delivery claim

When Hub participates in the installed cross-repository nightly queue, start a
manual delivery client under the same claim before its first write:

```text
python3 ~/.dotfiles/scripts/nightly_queue.py claim-run --config ~/.config/nightly-queue/config.json --repository jimmie-potts/agent-device-hub --issue <n> -- <manual-client argv>
```

Read `~/.dotfiles/docs/nightly-queue.md#shared-manual-claims` for the installed
procedure. Retain the claim through validation, reviews, publication, merge,
installation and tracker reconciliation, including when the scheduler is paused
or disabled. Explicitly assigned workers under the supervisor's existing claim
do not acquire nested claims. Before activation, existing unwrapped clients must
finish or hand off. Desktop or other clients that cannot be wrapped stay read-only
until a qualified claim/handoff covers their complete delivery. The helper
excludes adopted cooperating clients; it cannot fence arbitrary same-user
processes. A missing or uncertain claim blocks delivery writes without granting
permission to replace an owner.

## Review and merge

1. Complete authorized changes, relevant checks and applicable OpenSpec artifacts.
   Obtain successful current sync/archive lookups; synchronize every affected spec
   and archive on the delivery branch before final review. Incomplete tasks,
   missing acceptance or failed lookups prevent archive.
2. Commit the candidate and open a PR with Refs #<issue>. Record base, head,
   merge-base, diff command, clean worktree and validation. Avoid automatic issue
   closure before merged-revision CI: use no `close`, `fix` or `resolve`
   keyword (or variant) before `#<n>` anywhere in the body, including inside an
   ordinary sentence. PR #261 closed #87 at merge because its body said "the
   only wording fix #87 needs". Before a merge whose acceptance follows it,
   query the PR's `closingIssuesReferences`; a closing keyword anywhere in the
   body, including a "remaining work" bullet, links the issue. Reword the body
   to clear a reference (the read can lag a few minutes), and read back the
   issue state, not just its labels.
3. Obtain independent read-only Standards and Specification reviews of the same
   fixed comparison through code-review. When the change has observable
   behavior, also obtain an independent [Acceptance review](#acceptance-review)
   of that comparison. Fix P0-P2 findings; record lower-priority
   dispositions and reassess changed candidates. Self-review cannot authorize merge.
4. Read all GitHub reviews/threads and verify the [Depot evidence](#depot-ci-evidence)
   for the current PR head. Require every applicable configured job to succeed,
   including matrix jobs; missing, pending, skipped, cancelled or failed jobs
   prevent merge except for the verified guide-only filtering described below.
   Apply the UI verification policy below.
5. Immediately recheck issue scope/dependencies, main and PR head. Refresh affected
   tests/reviews when either commit changes. Squash only the reviewed head with
   gh pr merge <number> --repo jimmie-potts/agent-device-hub --squash --match-head-commit <head> --body "<text>".
   Always pass an explicit `--body`: by default the squash commit copies the PR
   description, and a "close #n" line in it closes the issue at merge, before
   the post-merge checks (this happened to #252). Use a short body with no
   closing keyword, such as `Refs #<n>`.
   Never use --admin, a background merge service or account/privacy changes.
   When main advances during review and a spec file conflicts, keep both sides
   but reconcile a requirement that both changed into one paragraph; a stacked
   resolution was a P2 finding on PR #421.
6. Read back the main merge revision and verify its Depot evidence using the same
   rules, or record the guide-only exception evidence below. Close the delivered
   issue only after its acceptance is met, clear workflow labels and verify
   closure. Apply [tracker reconciliation](#tracker-reconciliation) to affected
   related issues; each retains its own acceptance gate.
   Do not close future implementation or device acceptance issues with a bootstrap.
7. Clean up this delivery's own worktree and scratch as described in
   [Cleanup after delivery](#cleanup-after-delivery).

### Acceptance review

**Observable behavior** means anything a user or device could notice from a
running application: pages, interactions, HTTP or MCP results, agent status,
device output, and the code, configuration or assets that serve them, including
refactors of those paths. A change has **no observable behavior** only when it
cannot alter any of that. Examples: prose documentation, contracts or library
code that no running application serves yet, test-only changes, and logging
that changes no user-facing or device-facing output. The generated work guide
keeps its own CI browser checks and needs no Acceptance review.

Verification has three tiers.

1. **Automatic.** Once an application has a shared scenario catalog, every PR
   runs it in CI through the in-memory end-to-end harness.
   [Hub #846](https://github.com/jimmie-potts/agent-device-hub/issues/846)
   adds both for the new runtime that
   [ADR 0012](decisions/0012-bunny-event-platform.md) describes.
2. **Acceptance reviewer.** A PR with observable behavior gets a third
   independent reviewer beside Standards and Specification. The reviewer has
   no part in the implementation or the other review axes. It works through
   these steps:
   1. Create a detached worktree of the exact reviewed head under the main
      checkout's `.local/worktrees/` or `.local/scratch/<task>/`. Install and
      build it there: `fnm exec --using=.nvmrc -- npm ci` and
      `npm run build`. For a composition, also prepare clean consumer
      checkouts at their `compose.json` pins in the same place. Never write
      to the coordinator's worktree.
   2. From that worktree, start a disposable verification run with synthetic
      data and simulated devices. Use the new runtime's adapter once #846
      lands. Until then, use
      `fnm exec --using=.nvmrc -- npm run -s verify -- <operation>` or the
      `verify:compose` form in [app verification](app-verification.md). The
      run must report a clean candidate, never `dirty`. A reviewer whose
      sandbox cannot reach the user manager uses the
      [host route](app-verification.md#explicit-host-route-for-codex-development-coordinators).
   3. Exercise the story's acceptance scenarios as a user would, only against
      the run's own endpoints: the browser dashboard, HTTP and MCP calls,
      synthetic agent events and simulated device output.
   4. Check each acceptance item against what the reviewer observed.
   5. Stop the runs, confirm their cleanup, and remove the review worktree and
      checkouts.
   6. Return `satisfied` or `not satisfied`, with findings, the scenarios run
      and the run IDs.

   The reviewer's authority is limited to those steps:
   - It may write only inside its review worktree, its runs' runtime roots and
     its proof roots.
   - It makes no source, branch, tracker or installed-system change.
   - It never reads or calls installed services or their ports, personal
     state or physical devices.

   Its screenshots and video stay under the main checkout's
   `.local/evidence/verify/`. The PR records only the verdict, the scenarios
   and the run IDs.

   A `not satisfied` verdict blocks merge like the other axes. After a fix, the
   reviewer re-runs the affected scenarios on the new head. Run at most one
   Acceptance run at a time on this host, because memory is the constraint. A
   composition counts as one run.

   A PR with no observable behavior skips this axis. It states "no observable
   behavior" and why, and the Standards reviewer checks the claim against the
   definition above. A user-requested read-only review or planning task starts
   no runs.
3. **Milestone sweep.** An epic may define installation milestones. A sweep
   runs the milestone's scenario catalog against the installed system, and
   adds physical checks where the milestone requires them. It runs only inside
   that milestone's story, and only with the owner's explicit authorization
   naming the installed target and the devices involved.
   - The milestone story defines how synthetic inputs are kept apart from, or
     removed from, installed state.
   - Every scenario that commands a device follows the device-permission rules
     in `AGENTS.md`.
   - For visual confirmation, prefer camera frames over the owner's
     description when a camera is attached (owner direction, 2026-10-04).
     Camera frames show the owner's room, so keep them under the main
     checkout's `.local/evidence/` and out of GitHub.

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
A rerun of one failed job on the same reviewed head needs the delivery's
authorization; the commands are in the
[diagnostic access procedure](development.md#depot-diagnostic-access). Record
the first attempt's failure and the retry in the PR evidence instead of pushing
an empty commit, which would change the reviewed head. GitHub's check-run
rerequest endpoint is not a route: it returns 404 for the Depot app.
If required diagnostic evidence is unavailable, report that gap and keep the
merge or completion gate pending. A dashboard sign-in requirement alone does
not block routine delivery whose check-run evidence is complete. Preserve the
separate guide-only exception, independent reviews, head guard and post-merge
verification.

### UI approval scope

No project UI requires human approval, including new or materially changed Hub,
dashboard, device-facing, Guide and Ask interfaces. Record the affected UI and
applicable automated, browser, visual and accessibility evidence in the PR.
Independent Standards and Specification reviews, an
[Acceptance review](#acceptance-review) for observable behavior, applicable CI
and guarded merge remain required. A missing required check or blocking finding
still prevents merge.

This policy supersedes older human UI approval requirements in issues, plans and
dated design snapshots. Preserve their design outcomes, validation, dependencies
and separately scoped acceptance. Reconcile active tracker wording during
authorized updates; do not rewrite historical approval evidence. Publication and
physical device operations retain their own authority requirements.

Assess the guide-only CI exception separately against every changed path.
Changes outside `docs/work-guide/`, including this policy, require normal CI.
The heading retains its existing anchor for links from older records.

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
apply. Follow the separate [UI verification policy](#ui-approval-scope). Required checks
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

For installed Hub upgrade and rollback work, follow the owning
[Hub upgrade procedure](../apps/hub/SETUP.md#upgrade-and-roll-back-the-installed-hub).

Authorized delivery finishes merged, installed on its established target and
verified. The owner’s standing installation authority covers that routine upgrade
and its documented recovery; do not ask for installation approval again. Review
the exact plan and complete included change bundle against that authority before
execution, retaining ownership, compatibility, digest, health and receipt checks.
A new target or effects outside scope need their own authority.

An explicitly source-only task, or an accepted issue that batches installation
with a reason and linked owner, may finish its source portion while overall
delivery remains installation pending. For changes confined to instructions,
documentation or development tooling, record the applicable installed
instruction/tool readback or why no runtime installation applies; do not restart
a service merely for prose.
Required acceptance that is unavailable remains pending, never waived by merge.

Read-only and planning work do not authorize installation. Personal hook/settings
changes, agent sessions, unqualified migration, new hosts and device commands
remain outside routine installation scope. Physical work needs an explicit IP
and permission for the test sequence/content replacement.

Keep source/CI, installation, real-client, transport and visible-device evidence
separate. A fake or successful HTTP command does not establish optical results.
Preserve the owning device repository's installation and restoration rules.
