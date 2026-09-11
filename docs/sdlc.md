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
4. Read all GitHub reviews/threads and current-head CI pages. Require every
   configured job to succeed, including matrix jobs; missing, pending, skipped,
   cancelled or failed jobs prevent merge. UI candidates also need explicit user
   approval, renewed after UI changes.
5. Immediately recheck issue scope/dependencies, main and PR head. Refresh affected
   tests/reviews when either commit changes. Squash only the reviewed head with
   gh pr merge <number> --repo jimmie-potts/agent-device-hub --squash --match-head-commit <head>.
   Never use --admin, a background merge service or account/privacy changes.
6. Read back the main merge revision and all its CI jobs. Close only the delivered
   issue after its acceptance is met, clear workflow labels and verify closure.
   Do not close future implementation or device acceptance issues with a bootstrap.

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
