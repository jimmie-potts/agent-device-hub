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

A story split from an epic or another story is drafted too, so it carries its
assessment when filed. The #830 split stories (#879-#883) had none, and the
decisions they needed surfaced at PR time. When parallel stories change the
same source module or interface, such as `packages/sdk/src`, each split story's
issue names the interface and the one story that owns the module before work
starts; another story asks that owner for a change instead of editing it.
Root manifests, the lockfile and CI stay under the coordinator rule in
[Scope and implementation](#scope-and-implementation), and each story still
adds its own checks, documentation and spec deltas.

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

Work that crosses a component boundary, in ordinary work as well as under
`plan-work` or `deliver-work`, names these in the issue, plan or brief:

- its entry points and hand-offs;
- its refusals, and its succeeded, failed and uncertain outcomes (with
  `expired` where a command can wait), and the effects each may leave;
- its codes and retry policy;
- its diagnostic records and trace continuity;
- its fault cases.

The rules are in ADR 0012's
[Errors, effects and outcomes](decisions/0012-bunny-event-platform.md#errors-effects-and-outcomes)
and [Observability](decisions/0012-bunny-event-platform.md#observability), and
in the [diagnostic contract](observability-contract.md). For each item, name
the rule it follows or the exception it needs and why; do not copy the rule.
The Work item template asks for this in its "Boundaries and outcomes" prompt;
the answer goes in "Behavior and protections to preserve", with a `###`
subheading at most, because a new `##` heading ends that section for the Guide.
A story that crosses no boundary may say so in one line.

Prefer existing components and explicit manual steps where practical. Avoid
speculative platform support, abstraction layers, automatic rollback systems and
broad outage matrices. Always protect supported behavior: one authoritative
state owner and one writer per device, correct targets, bounded queued work, no
unsafe replay, accurate freshness and completion, manual control, and user data
integrity.

Select local tests for the changed behavior and its direct consumers. For
runtime work, use the affected disposable scenarios and the full-suite triggers
in [Runtime verification runs](development.md#runtime-verification-runs).
Keep existing hosted CI coverage and the applicable independent reviews. Add a pilot,
benchmark, soak or wider failure matrix only for an accepted requirement or a
demonstrated problem.

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
Pixoo's code is staged under `modules/pixoo` (#25); the Nanoleaf port is #26.

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
   Validate locally before every push: build once, then run the affected
   `:built` checks. Prove that a check fails with a local negative control.
   Before review, check every acceptance item against its evidence. Search the
   docs for each fact the change alters. Search at least `README.md`,
   `AGENTS.md`, `docs/architecture.md`, `docs/development.md`, `docs/sdlc.md`,
   the ADRs under `docs/decisions/`, the contract documents, the OpenSpec specs
   and the affected app, package, controller and module READMEs and guides.
   State limits and remaining uncertainty in the review brief and the PR body.
2. Commit the candidate, push it once its local checks pass, and open a PR with
   Refs #<issue>. Start step 3's reviews on that head while hosted CI runs:
   hosted runners find problems local checks cannot, such as #873, #875 and
   #877. Push one head per fix round, not intermediate commits. A push that
   only gathers hosted evidence, such as a failing probe, goes on its own draft
   PR with no closing keyword, closed unmerged afterwards, never on the head
   under review. Record base, head,
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
   of that comparison. Fix P0-P2 findings. Also fix a P3 that affects
   correctness, test coverage or a named later story, such as a mutant the
   suite lets survive; reviewers mark which P3s these are. Record a disposition
   for every other P3. Reassess changed candidates. Self-review cannot
   authorize merge.

   For a change that crosses a component boundary, the reviewer brief names the
   boundaries the diff crosses. The Standards and Specification axes each check
   the change against ADR 0012's
   [Errors, effects and outcomes](decisions/0012-bunny-event-platform.md#errors-effects-and-outcomes)
   and [Observability](decisions/0012-bunny-event-platform.md#observability)
   and the [diagnostic contract](observability-contract.md):
   - **Standards:** privacy and safe errors on every outward surface, records
     at decision points with their levels and trace continuity, and test
     integrity (the negative controls of step 1, and no unexplained weakened
     assertion).
   - **Specification:** outcome and effect semantics, codes and retries,
     coverage of the issue's fault cases, and whether each exception to a rule
     is honest, stated and justified.

   [ADR 0012 rules and their checks](development.md#adr-0012-rules-and-their-checks)
   shows which rules a test, kit check or lint rule already enforces, and
   which ones the reviewer checks.

   Each axis owns review sources. The Standards axis owns every `AGENTS.md` and
   `CLAUDE.md`, this file and `docs/development.md`. The Specification axis
   owns the issue, the OpenSpec specs and the contract documents. For a change
   that crosses a component boundary, ADR 0012 and the diagnostic contract are
   sources of both axes. A later delta
   goes back to both reviewers, with three exceptions that one reviewer
   confirms:
   - **Pure rebase:** the range-diff shows every commit identical. Either
     reviewer confirms it. If the new base changed one axis's sources, or the
     issue changed since the review, that axis confirms it. If both axes'
     sources changed, both confirm.
   - **Documentation only:** the delta changes only Markdown documentation that
     no tool reads. The axis that owns the changed files confirms it; files
     that neither axis owns may be confirmed by either. If it changes files that
     both axes own, both confirm.
   - **Code comments only:** the delta changes only comments that direct no
     tool. The Standards reviewer confirms it.

   These still go back to both: any change to an `AGENTS.md`, a `CLAUDE.md` or
   this file, directive comments such as `@ts-expect-error`, Markdown that a
   tool reads (such as issue templates or fixtures), a delta that mixes
   documentation and code comments, and any change to code, schemas, tests or
   configuration. The confirming reviewer's return names the new head. The
   other axis's earlier verdict carries over to that head, and the PR body
   records the carry-over with the range-diff or the diff. The
   [Acceptance review](#acceptance-review) rules are unchanged.
   Reviewer briefs say that reviewers make no GitHub writes, including reruns,
   merges and comments. Each brief names a short TMPDIR outside every checkout
   that no other agent uses, including the coordinator, such as
   `~/.cache/agent-device-hub/r917s` for PR #917's Standards reviewer, within
   the [TMPDIR length limit](development.md#standalone-hub-checks): two
   reviewers that chose the same name deleted each other's copies. The reviewer
   removes it at the end. Standards and Specification reviewers read a shared worktree but never
   build or test in it, because a build rewrites `dist/` under the coordinator
   and the other reviewers. They build and test in a `git clone` of the
   repository under their TMPDIR, checked out detached at the head; a
   `git archive` extract lacks the Git metadata that the Hub and observability
   package suites read. The coordinator leaves a worktree under review
   unchanged until that round's reviews return. An Acceptance reviewer follows
   [Acceptance review](#acceptance-review).
   Merge each story as soon as its gates pass, and start new work from merged
   main rather than from an unmerged branch.
4. Read all GitHub reviews/threads and verify the [CI evidence](#ci-evidence)
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
6. Read back the main merge revision and verify its CI evidence using the same
   rules, or record the guide-only exception evidence below. Close the delivered
   issue only after its acceptance is met, clear workflow labels and verify
   closure, with stderr visible as [tracker writes](tracker-reconciliation.md)
   require. Apply [tracker reconciliation](#tracker-reconciliation) to affected
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
that changes no user-facing or device-facing output. A change entirely under
`docs/work-guide/` keeps the guide's own browser checks and needs no Acceptance
review.

Verification has three tiers.

1. **Automatic.** Once an application has a shared scenario catalog, every PR
   that runs the Checks workflow runs it in CI through the in-memory end-to-end
   harness. Markdown-only and guide-only changes skip it.
   [Hub #846](https://github.com/jimmie-potts/agent-device-hub/issues/846)
   adds both for the new runtime that
   [ADR 0012](decisions/0012-bunny-event-platform.md) describes.
2. **Acceptance reviewer.** A PR with observable behavior gets a third
   independent reviewer beside Standards and Specification. The reviewer has
   no part in the implementation or the other review axes. It works through
   these steps:
   1. Create a detached worktree of the exact reviewed head under the main
      checkout's `.local/worktrees/` or `.local/scratch/<task>/`. Install and
      build it there with `fnm exec --using=.nvmrc -- npm ci` and
      `fnm exec --using=.nvmrc -- npm run build`. For a composition, also prepare clean consumer
      checkouts at their `compose.json` pins in the same place. Never write
      to the coordinator's worktree.
   2. From that worktree, start a disposable verification run with synthetic
      data and simulated devices. For the new runtime and its modules, use
      `fnm exec --using=.nvmrc -- npm run -s verify:runtime -- <operation>`
      ([runtime adapter](../apps/runtime/verify/README.md)). For the old Hub,
      use `fnm exec --using=.nvmrc -- npm run -s verify -- <operation>` or the
      `verify:compose` form in [app verification](app-verification.md), and
      `fnm exec --using=.nvmrc -- npm run -s verify:chompi -- <operation>` for the
      [CHOMPI bridge](../apps/chompi-bridge/verify/README.md). The
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
   composition counts as one run. The Hub's wrappers above, and the host route
   for its adapters (`--app hub`, `runtime` and `compose`), refuse a `start`
   with `run-active` while any run is live on the host
   ([one run at a time](app-verification.md#one-run-at-a-time)). The pinned
   Nanoleaf and Pixoo cores ignore the variable, so `--app nanoleaf` and
   `--app pixoo` are not guarded. Stop your own run first. If the refusal names
   a run you did not start, wait for it or ask its owner; do not stop it.
   Another session's short-lived test runs count too and end by themselves, so
   wait and retry: the app-verify tests' `avt-*` runs, the Hub, runtime and
   CHOMPI verify suites' runs under their apps' own names, and a composition
   test's `<tag>-nl` and `<tag>-px` stand-ins.

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

Start once step 6 has confirmed that the merged revision's CI jobs succeeded,
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

<a id="depot-ci-evidence"></a>

### CI evidence

GitHub Actions runs Hub CI on GitHub-hosted runners. Depot CI ran it until
[#870](https://github.com/jimmie-potts/agent-device-hub/issues/870). For routine
merges and merged-main verification, successful GitHub check-run records are
sufficient; opening every successful job page is not required. Enumerate
expected jobs from the candidate's workflow configuration, including matrix
expansions and applicable branch/ruleset requirements:
- `.github/workflows/`, whose check runs are named after each job;
- for a revision that still has `.depot/workflows/`, that directory instead,
  whose check runs Depot named `<workflow> / <job>`.

An overall green PR indicator or an empty protection list does not establish
that the expected jobs ran.

Read all pages of check runs and relevant annotations. Verify each required
result is `completed` with conclusion `success`, has the exact candidate or
merged-main SHA, belongs to this repository and the expected PR or main event,
and comes from the revision's CI app: `github-actions`, or `depot-code-access`
for a Depot-era revision. Retain job names, check IDs, revision and details URLs
in delivery evidence. Resolve superseded attempts and contradictory results
before accepting a successful rerun. Checks from another app or revision do not
qualify. Runs from the other provider on the same revision do not count, and
they waste minutes; rebase a branch that still has `.depot/workflows/`.

Inspect relevant job details, logs or artifacts when a job fails, results
conflict, a job is missing or unexpectedly skipped, workflow changes leave actual
coverage uncertain, or acceptance requires evidence beyond a success status.
Use the [diagnostic access procedure](development.md#ci-diagnostic-access).
A rerun of one failed job on the same reviewed head needs the delivery's
authorization; the commands are in the
[diagnostic access procedure](development.md#ci-diagnostic-access). Record
the first attempt's failure and the retry in the PR evidence instead of pushing
an empty commit, which would change the reviewed head.
If required diagnostic evidence is unavailable, report that gap and keep the
merge or completion gate pending. Preserve the separate guide-only exception,
independent reviews, head guard and post-merge verification.

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
Changes outside `docs/work-guide/`, including this policy, require normal CI as
the workflows route it; see [Markdown-only CI routing](#markdown-only-ci-routing).
The heading retains its existing anchor for links from older records.

### Guide-only CI exception

All CI workflows exclude changes entirely under `docs/work-guide/`. This includes
its generators and tests. For a guide-only PR and its main merge, the coordinator
may accept intentionally absent runs only after recording all of the following:

- The exact base/head or before/after merge revisions, the complete changed-file
  list, and the workflow triggers at the candidate revision. Use the PR's full
  comparison and the push's comparison separately; include deletions and both
  paths of renames. Every path must remain under `docs/work-guide/`.
- Successful local guide generation, generated-output consistency, maintenance
  tests and browser checks from the exact candidate using the guide procedure,
  plus a zero exit from `npx eslint docs/work-guide`. Retain the HTML hash,
  screenshots, print check and verification receipt outside Git. Validate the merged tree and repeat checks if its guide content differs.
- CI event/head associations and GitHub check readbacks consistent with those
  filters, plus the current protection and merge-state inspection. Missing runs
  alone, failed API reads or a cancelled run do not establish intentional filtering.

Independent Standards and Specification reviews and guarded squash merge still
apply. Follow the separate [UI verification policy](#ui-approval-scope). Required checks
that remain pending block merge; never bypass protections or emit dummy success
checks. Record unavailable protection reads and inspect the PR's authoritative
merge/check state.
Any changed path outside the guide folder requires normal CI, including a
rename out of the folder. If path scope or filter applicability is uncertain,
retain the normal gate until resolved. Changes to workflows, CI scripts or the
delivery preflight receive full CI and cannot use their proposed exception to
approve their own delivery.

For issue closure and later authorized publication, the verified guide-only
receipt replaces only the absent Hub CI evidence. All other acceptance and
publication requirements remain in force. Record this distinction explicitly.

The initial GitHub-generated README commit only creates the default branch.
Subsequent bootstrap and product changes use PRs. Do not assume private-plan
branch protection is available or absent; honor configured protections and retain
these procedural gates.

### Markdown-only CI routing

The Checks workflow ignores `**/*.md`. A revision whose every changed path is a
Markdown file runs only the Workflow and Work guide jobs. Those jobs must
succeed, and the delivery preflight derives that expected set from the
workflows. The Workflow job still runs OpenSpec validation, the issue-template
and fixture tests and the delivery preflight fixtures. Markdown-only edits to
this policy, `AGENTS.md` or `CLAUDE.md` take this route too, because no Checks
job reads them. Reviews, guarded merge and merged-main CI apply as usual.

Package scripts copy some Markdown files into published archives, such as
contract documents and package READMEs. Text edits to those files stay
Markdown-only. The Workflow job fails if any of them is missing, so delete or
rename one only together with its package script. That change runs every job.
That guard checks only that the files exist. Package scripts may copy the
guarded files, but no Checks test may depend on Markdown content. A test that
does must run in the Workflow job, which still runs for Markdown-only changes.

The `docs/work-guide/` and `**/*.md` filters combine. A revision that changes
only guide files and other Markdown therefore skips Checks too, and it needs
the [guide-only evidence](#guide-only-ci-exception) for its guide files; the
delivery preflight requires it. If a change's file list or filter behavior is
uncertain, keep the full gate.

## Installation and evidence

Identify the selected installation before planning an upgrade. The current
B.U.N.N.Y. installation is `apps/runtime`, whose [setup guide](../apps/runtime/SETUP.md)
owns fresh setup and manual return to retained old services. It does not supply a
qualified routine upgrade/rollback command. Source delivery must not silently use
the legacy installer or claim installation complete when the selected runtime's
upgrade procedure is unavailable. Preserve the source result and report that
installation gate pending until the owning procedure is qualified.

For a selected retained legacy Hub, follow the
[Hub upgrade procedure](../apps/hub/SETUP.md#upgrade-and-roll-back-the-installed-hub).
That installer targets `apps/hub`, not `bunny-runtime.service`. The accepted
[#840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840)
stopped and disabled the old writers while preserving their manual return path;
retirement remains separately authorized work.

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
