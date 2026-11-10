# Development workflow

## Authority and preparation

GitHub issues own requested outcomes, acceptance criteria, dependencies, status
and delivery targets. OpenSpec owns substantial capability scenarios and contract deltas when needed. Architecture/ADRs own lasting decisions. PRs own candidate revisions,
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

At pickup or a material scope change, check the requested outcome, actual setup,
risks and smallest useful change. Keep the assessment in the existing issue/PR;
a separate template, skill lookup or dossier is not required. Read-only work
reports the assessment without writing. Shared interface work names its owner
and integration order; independent work continues in separate worktrees under
[Parallel delivery](#parallel-delivery).

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

<a id="pickup-check"></a>
**Pickup check.** Before any code, find open PRs that deliver the issue: run
`gh pr list --state open --search "<number>"` and check branch names for
`gh-<number>-`. A PR that only mentions the issue as related does not count.
Read the issue's workflow label. If someone else holds it as `status:in-progress`
or `status:review`, or has an open PR for it, do not start: review or join that
work, or report the conflict. A claim is this session's own, and it continues,
only when it set the claim or the issue, PR or brief explicitly transfers that
claim to it, for example by naming the prior holder or saying to take over or
continue it. A request or ownership line that only names the issue is not a
transfer. Otherwise replace the workflow label with `status:in-progress` and
read it back before creating a branch.

A small issue needs the requested outcome, acceptance checks and delivery target.
Add implementation, risks, dependencies and deferrals only when they matter.
The [Work item template](../.github/ISSUE_TEMPLATE/feature.md) supplies optional
prompts, not a mandatory dossier. No fixed bullet count or empty heading is
required. New stories, whatever their size, do not add a model choice,
Execution recommendation, host table, pasted prompt or fingerprint; one
planned-start sentence in prose is enough, and the three ratings, complexity,
uncertainty and impact, are optional on one line. Existing bodies keep the
sections they have. Preserve existing issue structure where tooling consumes
it; do not bulk-reformat old issues. Put evidence in CI and a concise PR,
linking it from affected issues.

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
subheading at most, because a new `##` heading ends that section for the section parser.
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
remove requested behavior; ask the user when a cut would change it. A deferral
that rests on an agent's difficulty estimate records the evidence for it. Scope
defaults retain focused review, applicable CI, UI verification and the source,
installation and physical boundaries. OpenSpec is proportional to the change.

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

Start with a short description of the useful outcome and how to check it.
Use a few bullets when they help. The template's detailed prompts are optional;
there is no exact headline or bullet-count requirement. Investigations promise
findings, not shipped features. State unknowns and the delivery target honestly.
Tools that parse detailed sections still use their recognized headings when
those sections are present. Existing issue bodies remain valid.

## Scope and implementation

Use available code-review for independent review and writing-for-agents for
instructions. Design and tdd skills are useful aids. A missing workflow skill is
not a delivery gate: report it once and do the needed design, meaningful failing
regression scenario or editorial check directly. Do not copy or install skills
as incidental work. Use deliver-work only when explicitly invoked; repository
scope and authority still apply.

Refresh current main and work in an isolated branch/worktree with one coordinating
writer. Preserve other sessions' work. The independent reviewer covers both axes
in [Review and merge](#review-and-merge); additional review follows actual risk.
Reviewers may test in disposable copies, never rewrite the coordinator's outputs.

New Tidbyt and LIFX work belongs in this monorepo under their scoped controller
instructions. Assign one writer per deliverable; coordinate the integration of
shared contracts, root manifests/lockfile and CI. Merge shared prerequisites
before dependent work claims compatibility. A controller change validates its
affected consumers; shared changes validate every affected controller.
Pixoo's code is staged under `modules/pixoo` (#25); the Nanoleaf port is #26.

Substantial behavior changes and shared contract changes use an issue-linked
OpenSpec proposal, capability deltas and tasks. Small fixes, documentation and
tooling use a concise issue/PR with focused checks; update any affected existing
spec without inventing a proposal for unchanged requirements. Storage migration,
writer exclusion and installation changes need a short failure/recovery design
before implementation. The manual-maintenance design is a design input, not a
shipped contract or permission to change installed behavior.

Use npm run openspec -- <arguments> from the assigned root and an exact
gh-<issue-number>-<slug> change under openspec/changes. Inspect active and archived
names before creation. Initialize with init --tools none --profile core --no-animation.
Evaluate conditional design omission against the schema and record its reason.

Before product implementation, define proportionate executable tests and build/
type checks in docs/development.md and CI. Use a meaningful failing scenario
before its fix; imported bootstrap workflow fixtures do not establish a product
red/green result. Do not widen scope to satisfy a test or rewrite device behavior
as incidental cleanup.

## Parallel delivery

Parallel work is the default for this personal project. In separate worktrees,
tasks may implement, build, run independent tests, obtain read-only reviews and
publish draft PRs without another task's permission. The same filename in two
worktrees is an integration concern, not exclusive ownership of both copies.
Coordinate incompatible interface decisions before relying on them; establish
merge order where one candidate needs another, refresh the assembled candidate
and renew only evidence invalidated by the integration. Existing review and CI
gates still apply. Never build in or edit another task's or reviewer's worktree.

Require a handoff only when control of a shared mutable resource changes, such
as a checkout, tracker field, installed runtime or physical device. Name the
resource, current owner, protected operation or baseline, and release condition
in existing task evidence. Keep the hold as narrow and short as that condition
allows. Waiting for user input does not reserve unrelated resources or stop
independent source work. Reconcile an existing hold with its owner or designated
coordinator before changing it; silence, elapsed time and an idle-looking process
are not release evidence.

Use accepted prerequisite revisions and recorded releases directly after
verifying their scope and current state. A second conversational acknowledgment
is unnecessary when that evidence already establishes readiness and ownership.
A closed issue or queued message alone does not. Missing evidence blocks only
the operation that depends on it. Progress updates need no acknowledgment unless
they request a decision or transfer a resource. Coordinators resolve concrete
conflicts; they do not approve every task action. Escalate only a scope decision,
new authority or unresolved conflict, and continue independent authorized work.

For disposable verification, independent tasks may start simulated runtimes
concurrently through the normal npm wrappers or host route. Each run uses its
own worktree, build outputs, ports, synthetic credentials and state. There is
no default run-count limit or capacity-qualification gate. Keep the existing
two-hour leases, extension, expiry and cleanup; stop only your own runs. Stop
unneeded owned runs if resources become constrained. Household installation
remains serialized, and physical devices keep one designated writer and their
existing explicit authorization.

## Canonical checkout refresh

Use the designated canonical checkout and existing refresh owner when known;
reuse that discovery until it changes. Tasks work from their own worktrees and
immutable revisions, so another task's canonical refresh is not a prerequisite
for their source work, merge or source closeout. One designated writer can refresh
the canonical checkout for several deliveries. This grants no startup-update authority.

After verified merge and required merged-revision CI, follow the shared
[canonical checkout refresh procedure](https://github.com/jimmie-potts/agent-skills/blob/main/skills/deliver-work/references/project-discovery.md#canonical-checkout-refresh).
Reading the procedure does not invoke the explicit-only skill. Refresh the remote
target, record its immutable SHA/time and prove it contains the delivered merge.
Establish exclusive writer ownership through the existing participating claim or
verified owner handoff; clean status or an idle-looking session is insufficient.
An existing scoped release is sufficient; do not request another acknowledgment.
Recheck branch, expected HEAD, index/worktree/untracked state and ownership
immediately before fast-forwarding only to that observed SHA.

Retain a pinned, dirty, wrong-branch, diverged or concurrently owned checkout;
retain it when authority, remote evidence or writer exclusion is unknown. Never
switch branches, reset, stash, clean, force refs or discard another owner's data.
If updating activates installed sources, use their complete owning update
procedure and timing/authority checks first. Preserve source-only limits; no
generic Git update may bypass installation. Instruction-only changes need
file/revision readback, not a service restart.

Read back branch and exact SHA. Reconcile interrupted or uncertain results before
retrying; an observed completed update needs no second mutation. Record checkout,
observed target/time, before/after revisions, ownership evidence and `updated`,
`already current`, `retained/pending` or `not applicable` in the existing delivery
record. Pending results name reason, owner and next action. Keep source completion,
checkout refresh and required installation separate; pending refresh does not
undo a verified source merge or claim updated instructions.

## Tracker reconciliation

Update the selected issue at completion or a material scope/dependency change.
Update related parents or dependents only when their acceptance, next action or
ownership actually changes. No backlog sweep, recommendation regeneration or
portfolio pass is required for a routine PR. Use the narrow read/write/readback
rules in [native issue reconciliation](tracker-reconciliation.md).

Link existing PR/CI evidence rather than copying it into multiple reports.
Never infer installed or physical acceptance from a source merge. Project updates
are needed for changed selected-item status or explicit portfolio work; preserve
owner Phase/Commitment choices. Unavailable projection access is a reported gap,
not a source-delivery blocker. See [Project maintenance](project-maintenance.md).

## Review and merge

1. Finish the scoped change and run the checks selected by its owning guide and
   `npm run ci:select`. Use regression tests for meaningful behavior; demonstrate
   that they catch the defect or unsafe case. Documentation uses link, instruction
   and readback checks. Search the documents whose facts changed. Complete and
   sync/archive an OpenSpec change when this task uses one.
2. Commit and publish a PR with a short description of the problem, resulting
   behavior, relevant tests and limits. Record the comparison base/head. Start
   independent review while hosted CI runs. Keep the candidate stable during a
   review round; push one tested candidate per fix round.
3. One independent reviewer uses code-review when available and reports separately
   on **Standards** (correctness, security, maintainability and tests) and
   **Specification** (the requested outcome and acceptance). Self-review is not
   sufficient. For component boundaries, check ADR 0012 outcomes, effects, retries
   and the diagnostic contract. Add a focused second independent review for
   substantive credential, storage-migration, writer-exclusion or device-command
   safety changes; document which risk it covers. A prose-only policy change does
   not automatically need a second reviewer, but a new safety design does.
   Fix P0–P2 and correctness/test-coverage P3 findings; disposition other P3s.
   A finding in code the change did not touch does not block it unless the
   change makes that defect reachable or worse; record it with an owner and
   follow-up, as `AGENTS.md` does for unrelated failures.
   The review report gives it the state `pre-existing`, which the preflight
   reads and never counts as open. A finding the change makes reachable or
   worse, one the requirements put in scope, or a missing required change is
   never `pre-existing`; it is `unresolved` and blocks.
   The same reviewer may perform the disposable acceptance exercise below.
   Re-review changed behavior and affected assumptions, not unchanged evidence.
   A pure rebase or prose correction needs one confirmation of the delta and new
   comparison. Never carry a verdict over a change that invalidates its evidence.
   Count final review rounds that assess a new candidate or one corrected to
   resolve a P0–P2 finding, whatever its file types. Confirming a base move, a
   pure rebase or a correction that targets no P0–P2 finding does not count,
   and a correction that targets one counts whether or not it resolves it.
   If the third counted round leaves a P0–P2 finding open, stop fixing: the
   coordinator reports the open findings and proposes a changed approach to the
   owner, and the merge stays blocked until the owner chooses. Independent
   authorized work continues. A changed approach the owner chooses starts a new
   allowance of rounds; a new PR for the same issue without that choice does not.
   Reviewers make no GitHub/source writes. They read the shared candidate or build
   and test in their own disposable clone and clean it up; they do not build in
   the coordinator's worktree.
4. Resolve published blocking feedback and require every applicable CI job on the
   exact head to pass under [CI evidence](#ci-evidence). Focused admission and
   release qualification preserve coverage at their separate boundaries. Do not
   rebase solely to obtain an up-to-date build; refresh the current comparison,
   resolve conflicts and renew evidence invalidated by integration. No extra report
   format or duplicated receipt dossier is required; a PR review summary with
   comparison, verdicts and links to existing evidence is sufficient.
   A **gate-policy change** touches `.github/workflows/**`, branch protection
   settings, `scripts/ci-selection/**`, `scripts/delivery-preflight/**`, the
   numbered steps of "Review and merge", or its "Acceptance review", "CI
   evidence", "UI approval scope", "Markdown-only CI routing", "Affected PR
   checks" or "Integration, qualification and deployment" subsections. Its
   other subsections, such as
   "Cleanup after delivery", "Workspace audit" and "Tracker audit", are not gate
   policy. A gate-policy change also needs the owner's acknowledgement
   before merge: the owner's own words, on the PR or in chat to the coordinating
   session. The coordinator records a chat acknowledgement on the PR, quoted with
   its time. No agent originates one or infers it from silence, an earlier
   approval or another session's report. Other edits to `AGENTS.md`, this file or
   `docs/development.md` do not need it, and the focused second review areas in
   step 3 gain no human gate.
5. Recheck scope, base and head, then squash the reviewed head with
   `gh pr merge <number> --repo jimmie-potts/agent-device-hub --squash --match-head-commit <head> --body "Refs #<issue>"`
   or the API equivalent with an expected-head guard. Never use `--admin`.
   Avoid closing keywords while acceptance remains pending. If GitHub links a
   closing reference, remove it and read back before merging.
6. Read back the merge revision and its applicable main CI. Close only issues
   whose own acceptance is met, with installation/device evidence where required.
   Update affected related issues and verify writes. Keep incomplete acceptance
   open with the missing evidence. Clean up only this task's resources under
   [Cleanup after delivery](#cleanup-after-delivery).

### Acceptance review

**Observable behavior** means anything a user or device could notice from a
running application: pages, interactions, HTTP or MCP results, agent status,
device output, and the code, configuration or assets that serve them, including
refactors of those paths. A change has **no observable behavior** only when it
cannot alter any of that. Examples: prose documentation, contracts or library
code that no running application serves yet, test-only changes, and logging
that changes no user-facing or device-facing output.

Verification has three tiers.

1. **Automatic.** Ready PRs run the [admission selection](#affected-pr-checks).
   Core scenario checks remain selected for affected runtime changes. Broad
   browser/catalog coverage runs for conservative PR selections and every pinned
   release qualification. Main pushes run cheap integration checks and enqueue
   qualification independently of later feature work. Draft updates do not run
   expensive admission or release checks.
2. **Acceptance exercise.** A PR with observable behavior needs the affected
   user journey exercised against the reviewed head in a disposable run. The
   independent code reviewer may do this; a separate third reviewer is optional.
   Reuse applicable automated/browser evidence and run only missing scenarios.
   The reviewer has no part in implementation and follows these steps when a
   run is needed:
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
      For the runtime, the explicit [finite offline route](../apps/runtime/verify/PORTABLE.md)
      is also supported under the ADR 0009 amendment. Use a clean exact-head
      checkout and its immutable test image, one independently owned synthetic
      run, retained assertions/PNG/finalized video and verified exact-container
      cleanup. No installed service or personal state is accessible to that run.
      The separate portable receipt names its deadline and suspension limits;
      it does not assert a systemd lease or handed-off preview. An unsupported
      earlier route remains incomplete. The reviewer must inspect the user-facing
      observations and evidence, rather than substitute a catalog's exit status
      for its own verdict. All review and merge gates below still apply.
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
   reviewer re-runs the affected scenarios on the new head. Independent tasks
   may run disposable simulated runtimes concurrently, including Acceptance
   runs, with separate worktrees and build outputs. Use the normal launchers;
   they impose no default run-count limit. Preserve each run's lease, private
   state, credentials and exact ownership. Reset, capture and stop only your
   own runs. The shared core's [optional one-run guard](app-verification.md#one-run-at-a-time)
   remains available for explicit opt-in; it is not required for task launches.

   A PR with no observable behavior skips this axis. It states "no observable
   behavior" and why, and the independent reviewer checks the claim against the
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

Start once [Review and merge](#review-and-merge) step 6 has confirmed that the
merged revision's CI jobs succeeded and read back the issue state.
Cleanup does not wait for installation or physical acceptance unless that work
still uses the resource. This applies to ordinary delivery and to explicit
deliver-work alike. While working, note each worktree, branch, scratch folder, clone,
review copy and staging directory when you create it, and each consumer when one
arises, because cleanup depends on that record. Keep it in the task's own notes, or
in the canonical local checkout's `.local/evidence/` for anything private, because
removing a worktree deletes the worktree's own `.local/`.

Clean up only what this delivery created and still exclusively owns. The positive
evidence is the task's own record that it created the resource and handed it to
nobody. Clean status, an idle-looking session or a lack of visible processes does
not show that a session has released a resource: a paused session can resume in a
removed directory. Anything else is unknown ownership, and unknown ownership retains
the resource.

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
3. Clean up the canonical local checkout's
   `.local/scratch/gh-<issue-number>-<slug>/` folder and any independent clone,
   review copy or staging directory this task created. Find them from the task's
   own record, because a standalone clone is not in the worktree registry. Apply
   step 2's evidence check to each. A clean status does not show that a checkout's
   commits are safe, so also check them:
   - In a standalone clone, run `git -C <path> stash list` and
     `git -C <path> log --oneline HEAD --branches --not --remotes`.
   - In a nested worktree, run `git -C <path> log --oneline HEAD --not --remotes`.
     It shares refs and stashes with its repository, and they survive its removal,
     so only a detached commit is at risk here.

   Retain any that lists a stash or a commit, unless the commit belongs to the merged
   PR, and any that an installation, acceptance exercise or other task still uses.
   Retaining a nested resource retains its folder. For the rest,
   remove each worktree registered inside with ordinary `git worktree remove`, confirm
   that `git worktree list` shows none there, then delete the folder and confirm it
   is gone. Step 1's `HEAD` check applies only to the delivery worktree.
4. For a delivery worktree created with `git worktree add`, run
   `git worktree remove <path>` from the canonical local checkout and confirm
   with `git worktree list` that the path is gone.
5. Leave a tool-managed worktree, such as a Claude Code session worktree under
   `.claude/worktrees/`, to that tool's own exit flow instead of
   `git worktree remove`; that flow may also delete its branch. Once steps 1 and
   2 and step 6's use and consumer checks pass on a clean worktree, ignoring that
   worktree's own entry in the porcelain list, accepting the
   tool's option to discard the squash-merged commits is allowed. If the flow deleted
   the branch, do step 6's readback instead of its removal. If this session cannot
   run that flow, keep the worktree and report it as retained and ready to remove;
   that is not a completed removal.
6. Once the worktree is gone, remove the delivery's local branch if all of these
   hold. Otherwise retain it:
   - `git worktree list --porcelain` names no `branch refs/heads/<branch>`, and no
     session or other task still uses it. Git lists a worktree that is rebasing as
     `detached`, so for each `detached` entry confirm that `git -C <path> status` shows
     no rebase of this branch.
   - The task's record names no remaining consumer, such as an installation or
     publication.
   - `git rev-parse refs/heads/<branch>` equals the reviewed head from step 1. A
     moved tip is unfinished or unknown work.

   Delete only that exact ref from the canonical local checkout, immediately after
   those checks: `git update-ref -d refs/heads/<branch> <reviewed-head>`. The guard
   must be the non-empty full SHA, because an empty value deletes with no guard. The
   guard refuses a moved tip but does not stop a concurrent checkout, so it does not
   replace the checks above.

   Read back with `git show-ref --verify --quiet refs/heads/<branch>`. Exit 1 means
   the ref is gone; any other exit code, such as 128 outside the repository, leaves
   the result unknown. If `git config --get-regexp '^branch\.<branch>\.[^.]*$'` lists
   anything (escape regex metacharacters in the branch name), run
   `git config --remove-section branch.<branch>` and repeat the query, which must then
   exit 1.
   Judge delivery from the merged PR as in step 1, never `git branch --merged`.
   Never use `git branch -D` or a sweep across branches. GitHub deletes a merged
   PR's head branch on merge: the repository's `delete_branch_on_merge` setting
   has been on since 2026-11-06
   ([#309](https://github.com/jimmie-potts/agent-device-hub/issues/309)). Read
   the result back with
   `git ls-remote --exit-code --heads origin refs/heads/<branch>`. Exit 2 means
   the branch is gone. Exit 0 means it is still there, so report it under step 8
   rather than deleting it. Any other exit code leaves the result unknown. A missing
   remote branch neither proves local delivery nor authorizes removing the local
   one, and this step deletes no remote branch.
7. Remove the Docker artifacts this task created: its stopped containers, the
   images it built and tagged, the untagged `<none>` images its rebuilds of
   those tags left (by ID, from `docker images -f dangling=true`), and its
   synthetic volumes and networks. Give them names that carry the issue number
   or the launcher's own `bunny-runtime-check-` identity, and start disposable
   runs with `--rm`, so this step is `docker rm`, `docker rmi`,
   `docker volume rm` and `docker network rm` of named artifacts, never a
   prune. Keep the installed stacks (`bunny-mac-personal*`, `bunny-tronbyt*`
   and `bunny-diagnostics*` containers, volumes and networks), every image a
   container still uses, the images that the private batch records under
   `~/.local/state/bunny-operations/` name (the current and previous installed
   image; the previous one is the return target the
   [container guide](bunny-container.md#replace-an-image) keeps) and the
   images named by the `compose*` files at the root of each retained release
   directory, qualified
   `bunny-core:release-*` images, third-party images, the shared
   `bunny-runtime-check-tools` caches, which every
   `npm run test:runtime:container` run of the same manifests reuses, and the
   retained release directories under `~/.local/share/bunny/releases/`, which
   the installed hooks and the running core reference. Confirm with
   `docker ps -a`, `docker images`, `docker volume ls` and `docker network ls`
   filtered by the task's name that nothing remains.
8. Record the cleanup result in the existing delivery evidence, the PR or issue
   comment that closes out the work. Give the branch, worktree, scratch, clone,
   staging directory and remote one outcome each: removed, with the readback that
   showed it; retained, with the reason, owner and next action; or not applicable,
   meaning this delivery created none. Cleanup that stops early still records this
   result. Claim removal only from a current readback. Source and CI completion stay
   separate from this result. GitHub receipts use neutral labels rather than
   private paths, configuration or runtime metadata.

Retain the affected resources, and record why under step 8, when a worktree
is dirty or locked, another process or session uses it, the delivery worktree's
`HEAD` differs from the reviewed head, merged-main CI is incomplete or unavailable,
evidence is not yet preserved, an ignored file is not confirmed disposable, a consumer remains,
ownership is unknown, or `git worktree remove` or the ref guard refuses. Without the
user's explicit approval, never force removal or reset, clean or discard files
to make a resource removable. If main CI fails, or the work failed or was
abandoned, ask the user whether to keep or remove it, keep it until they decide and
record it as retained under step 8. Leave other sessions' worktrees, branches and scratch alone. Branches and
worktrees that earlier deliveries left behind need a separately approved candidate
list ([#477](https://github.com/jimmie-potts/agent-device-hub/issues/477)); this
procedure covers only the current delivery's resources.

### Workspace audit

Run `npm run audit:workspace` from any checkout about weekly and before any
disk-space complaint. It is read-only. It lists every registered worktree other
than the main checkout with a verdict from its PR and tree state alone, not its
owner or session: removable when its PR is merged at the worktree's exact head and the tree is clean; otherwise
tool-managed, dirty, locked, prunable, open PR, closed PR, merged at another
head, no PR, detached or unknown state, each named for the decision it needs.
It also lists stopped task containers and unreferenced task images older than
the window (48 hours by default, `-- --hours <n>`), the images the batch
records and root-level release Compose files name (kept, listed by ID),
container-less volumes whose names mark them as task runs (an issue number, the
launcher's identity or an acceptance exercise, never data volumes), the shared
launcher caches and untagged images for the owner's decision, and
`docker system df`. Act on it
under the steps above: remove only what this task created, ask the owner about
closed-PR and detached worktrees, and leave tool-managed worktrees to their tools.
A `removable` verdict is not proof of ownership and does not cover the worktree's
branch, so another delivery's `removable` worktree waits for its owner or the approved
#477 list. Never prune images, containers, volumes
or the build cache as part of a task: the installed stacks, the qualified
release images and other sessions' builds share that daemon, and whether a
build is running cannot be seen from one session. Pruning is the owner's
decision, taken when no session is building.

### Tracker audit

Run `npm run audit:tracker` from any checkout after a batch of deliveries,
before a handoff or session closeout, and about weekly; nothing schedules it.
It is read-only and makes no tracker write. Within the window (72 hours by
default, `-- --hours <n>`) it lists closed issues that keep a workflow label
and merged PRs with no cleanup outcome under
[Cleanup after delivery](#cleanup-after-delivery) step 8. Across all open
issues it lists those without exactly one of the four status labels above,
leaving out `idea` issues; `status:in-progress` or `status:review` issues with
no comment since a PR that references them merged; and `status:review` issues
with no update for more than five days (`-- --stale-review-days <n>`). No
document sets a time limit on review: five days is the audit's default,
proposed in #1508. Each finding names its rule. Treat a finding as a prompt to check that record, not as proof: the PR
link and the cleanup signal are heuristics
([Tracker audit](development.md#tracker-audit)). Correct a confirmed gap under
[Tracker reconciliation](#tracker-reconciliation), within the owning writer's
authority; the audit itself never writes.

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

A pull request's CI runs only its [affected checks](#affected-pr-checks). A job
that selection deliberately leaves out reports `skipped`; it counts as not run,
never as passed, and it is acceptable only when the selection recomputed from
the PR's changed files omits it and the `Selected checks gate` job succeeded.
Merged-main source revisions run applicable integration jobs. Full release
qualification has its separate immutable candidate and applicable job set.

Inspect relevant job details, logs or artifacts when a job fails, results
conflict, a job is missing or unexpectedly skipped, workflow changes leave actual
coverage uncertain, or acceptance requires evidence beyond a success status.
Use the [diagnostic access procedure](development.md#ci-diagnostic-access).
A rerun of one failed job on the same reviewed head needs the delivery's
authorization; the commands are in the
[diagnostic access procedure](development.md#ci-diagnostic-access). Record
the first attempt's failure and the retry in the PR evidence instead of pushing
an empty commit, which would change the reviewed head.
A one-job rerun rarely helps Release qualification: a receipt binds only an image
built by its own attempt, so a rerun that doesn't rebuild the image ends
`incomplete` even with every job green. To qualify a candidate after a flaky job,
rerun all of its jobs.
If required diagnostic evidence is unavailable, report that gap and keep the
merge or completion gate pending. Preserve independent reviews, the head guard and post-merge verification.

### UI approval scope

No project UI requires human approval, including new or materially changed Hub,
dashboard and device-facing interfaces. Record the affected UI and
applicable automated, browser, visual and accessibility evidence in the PR.
The independent review and proportionate
[acceptance exercise](#acceptance-review), applicable CI and guarded merge
remain required. A missing required check or blocking finding
still prevents merge.

This policy supersedes older human UI approval requirements in issues, plans and
dated design snapshots. Preserve their design outcomes, validation, dependencies
and separately scoped acceptance. Reconcile active tracker wording during
authorized updates; do not rewrite historical approval evidence. Publication and
physical device operations retain their own authority requirements.

The initial GitHub-generated README commit only creates the default branch.
Subsequent bootstrap and product changes use PRs. Do not assume private-plan
branch protection is available or absent; honor configured protections and retain
these procedural gates.

### Markdown-only CI routing

Ready Markdown-only PRs run build/type/lint, workflow and retained documentation
checks, with product suites unselected. Changes to `AGENTS.md`, `docs/sdlc.md`
and `docs/development.md` change delivery/validation policy and retain the full
PR gate. Drafts skip expensive checks. Package-copy checks still require their
referenced Markdown files to exist; deleting one requires its packaging change.
No product test may depend on Markdown content; instruction fixtures belong in
Workflow. Main integration and qualification use the same scheduling policy for
Markdown and other changes.

### Affected PR checks

The selector in `scripts/ci-selection/selection.mjs` owns the explicit admission
mapping and the preflight recomputes it. Every ready candidate runs build,
typecheck, lint, workflow checks and the affected core unit/consumer suites.
Explicitly allowlisted runtime dashboard and module frontend style assets can use focused
admission, omitting the broad App verification and Runtime verification jobs.
The affected independent disposable acceptance exercise remains required.

Two existing standalone test entries have a narrower owning-command route:
`modules/wemo/tests/module.test.ts` runs the complete `npm run test:wemo:built`;
`apps/runtime/dashboard/tests/microduck.browser.ts` runs Chromium setup, dashboard
smoke and the complete `npm run test:microduck:browser`. Only modifications of
those regular files, optionally with ordinary Markdown, qualify. Build, typecheck,
lint, Workflow/docs checks and independent review remain required. Helpers,
fixtures, product/contract/lock/workflow/gate-policy changes, additions, deletions,
renames, type changes and incomplete metadata keep conservative selection.

For this route Core checks out the exact PR head. Wemo completion must show a
nonempty successful full suite and the changed compiled entry, with no failed,
cancelled, skipped or todo cases. MicroDuck completion follows the entire existing
browser journey, including keyboard, viewport, reduced-motion and accessibility
assertions; its dashboard smoke must also pass. Native notices bind the owner,
fixed complete command, head, run and attempt. The gate requires completion and
the preflight checks the notice against the actual native Core execution.
Missing, ambiguous, zero-match or wrong-head evidence refuses admission. A green
job alone does not establish owning-command completion.

Backend and safety-sensitive paths retain their existing broad selection. Shared
packages/contracts, toolchain/lockfile, CI/selector/preflight, gate-policy,
unknown paths and incomplete comparisons select full coverage. Author labels
cannot waive checks. Manual Checks dispatch and release qualification force full
selection. Keep substantive credential, storage-migration, writer-exclusion and
device-command safety review and checks.

Selected jobs must succeed on the exact candidate. An unselected job must report
`skipped` or `success` if it ran; a skip means not run. The Selected checks gate
must succeed. Missing results, failed selection, unexpected skips, cancellation
or wrong revisions block admission. Hosted focused notices bind both core groups
and omitted jobs. The preflight checks that published coverage covers its own.
Policy changes pass the conservative gate and independent review before they
activate, plus the owner's acknowledgement for a gate-policy change as defined
in [Review and merge](#review-and-merge); a candidate cannot waive its own
missing evidence.

### Integration, qualification and deployment

Main records integrated source. Its Integration workflow runs cheap workflow and
admission-regression checks on the exact merged revision. The separate Release
qualification workflow runs all applicable existing source, browser/accessibility
and packaged ARM64 coverage on a pinned integrated snapshot. One active run
finishes while new arrivals replace the pending candidate. Omitted intermediate
revisions are not qualified. A feature PR need not wait for qualification or a
merge/deployment batch; it must satisfy its own admission and acceptance gates.

A qualified release binds the exact source/evaluation revision, applicable job
results and immutable production image. Failed, incomplete or mismatched evidence
refuses deployment. A source preflight reports integration evidence separately
from qualification and installed acceptance. The release producer and consumer
are described in [development](development.md#release-qualification).

Feature tasks own source and disposable evidence. A designated deployment task
selects one compatible batch and owns only its installation operation. Feature
issues link that batch for remaining installed/client checks and retain any
unfinished acceptance. Reuse its verified deployment result and recorded writer
release directly; no second acknowledgment or per-feature installation handoff
is required. Project fields remain projections of native issue state.

## Installation and evidence

Identify the selected installation before planning an upgrade. The current
B.U.N.N.Y. installation is `apps/runtime`, whose [setup guide](../apps/runtime/SETUP.md)
owns fresh setup and manual return to retained old services. Before planning,
running or checking its upgrades/recovery, read the owning
[runtime upgrade procedure](../apps/runtime/UPGRADE.md), including its private plan, focused storage-change assessment, held operation
lock and receipt requirements. Routine forward admission is independent of recovery
eligibility and inactive integration qualification. Unknown recovery permits a
forward plan but refuses recovery selection; snapshot restoration requires a separate
explicit owner decision, preservation of failed latest state and a stated data gap.
Its first release-anchor adoption has a separately approved one-time override
and startup sequence; qualified routine upgrades retain standing authority.
Source delivery must not silently use the legacy installer or infer installed
qualification from source checks. Preserve the source result and report that
installation gate pending until the owning installed acceptance is satisfied.

For a selected retained legacy Hub, follow the
[Hub upgrade procedure](../apps/hub/SETUP.md#upgrade-and-roll-back-the-installed-hub).
That installer targets `apps/hub`, not `bunny-runtime.service`. The accepted
[#840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840)
stopped and disabled the old writers while preserving their manual return path;
retirement remains separately authorized work.

Overall installed delivery finishes with verified installation of its selected
qualified batch. Feature tasks can finish integrated source while their issues
retain pending installed acceptance through the designated deployment issue. The owner’s standing installation authority covers that routine upgrade
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
