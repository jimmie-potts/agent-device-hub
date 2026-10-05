# Working on the agent device hub

## Start and scope

Read the README sections relevant to the task for current implementation state
and setup. For planning or delivery, read docs/sdlc.md and the exact GitHub
issue. Before changing ownership, provider contracts, APIs, state, integration
or hosting, read docs/architecture.md and the linked device contracts.
Before designing or changing communication between components, read
[ADR 0012](docs/decisions/0012-bunny-event-platform.md). This covers events,
commands, replies, errors, message formats, consumer state and trace
propagation, and all such work follows that ADR.
[Epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) owns
the cutover. Until a component's own child delivery lands, extend its released
1.x contract only additively. This includes the owner's CHOMPI work. Do not add
another message format, error shape or new path that polls the Hub for state.
GitHub issues own the delivery sequence, acceptance criteria, dependencies and
status; do not copy issue lists or dependency chains into repository docs.

When drafting or picking up a story, or after a material scope or assumption
change, apply the [scope defaults](docs/sdlc.md#scope-defaults), including in
ordinary work without `plan-work` or `deliver-work`. At every pickup, refresh
alignment with current project direction, accepted architecture, reusable patterns
and related work; do not restrict discovery to the issue’s original sources.
A read-only request reports the assessment without writing.

At accepted child completion, reopening, material scope/prerequisite change or
ownership handoff, the coordinating writer applies the
[tracker reconciliation checkpoint](docs/sdlc.md#tracker-reconciliation)
before final closeout, including ordinary work without shared workflow skills.
Read-only work reports discrepancies; tracker-only work stays within its named
scope. Reconcile within the task's authority and verify writes by readback.

For portfolio planning, Project maintenance or delivery of a Project item, read
[Project maintenance](docs/project-maintenance.md). Read-only requests make no
Project changes. Authorized delivery covers routine projection for selected
work, within that procedure's field and ownership boundaries.

For planning, edits or review under controllers/tidbyt or controllers/lifx,
read that directory's README.md and AGENTS.md before working there, even when
launched from the repository root. controllers/tidbyt holds the fake-tested cloud
controller package; controllers/lifx holds the fake-tested LAN controller package. Before shared
package, root manifest, lockfile or CI changes, read
docs/development.md and coordinate with the owner of concurrent shared work.

Use the owning package and application guides for implementation details and
GitHub issues for current delivery status. Keep source delivery, installation and
physical acceptance separate.

Planning and review are read-only unless the user explicitly authorizes named
document or tracker changes. Those writes do not authorize implementing the
planned features.

During authorized work, fix failures that the requested change causes. Report
an unrelated visual, lint, test or flaky failure with its evidence instead of
fixing it, and ask for a separate task when a repair would expand the
authorized scope.

## Delivery and validation

Follow docs/sdlc.md for authorized implementation/delivery. Use centrally
installed code-review for review and writing-for-agents for instructions.
The catalog's deliver-work method is explicit-invocation only; use it when the
user names it, while retaining this repository's delivery gates.
Compose grill-with-docs for unsettled implementation-changing decisions and tdd
for meaningful executable behavior. Reuse the shared agent-skills catalog;
report missing prerequisites without copying, installing or replacing skills.

When this repository participates in the installed nightly queue, acquire its
shared manual claim before delivery writes and retain it for the whole delivery,
even while scheduled admissions are paused or disabled. Read
[the manual claim procedure](docs/sdlc.md#shared-manual-delivery-claim).
An explicitly assigned worker inside a held supervisor claim does not nest claims.
An unwrapped or nonwrappable client stays read-only until a qualified claim or
handoff; prose alone does not exclude another writer.

Use one coordinating writer and an isolated branch/worktree per deliverable.
Preserve other worktrees, branches, installations and their owners. Deliver
changes through PRs. Independent read-only Standards and Specification reviewers
must inspect the same committed base/head. A change with observable behavior
also needs an independent Acceptance reviewer. That reviewer runs the same head
in a disposable verification run, uses it as a person would and has only the
limited authority in [Acceptance review](docs/sdlc.md#acceptance-review), which
also defines observable behavior. Missing review,
blocking findings or any missing/unsuccessful applicable CI job prevents
automatic merge.
Use the Depot evidence rules in docs/sdlc.md for routine check-run verification
and conditional job/log inspection; diagnostic access is in docs/development.md.
Only changes entirely under docs/work-guide/ may use the intentional CI-filter
exception in docs/sdlc.md; read its evidence requirements before merge or closure. Recheck
scope, head and base before a squash merge guarded by --match-head-commit.
Never use --admin. Read all applicable merged-revision main CI jobs before issue closure;
for a guide-only filtered revision, record the docs/sdlc.md exception evidence.
No project UI requires human approval. Preserve applicable automated, browser
and accessibility validation, independent reviews and CI under the
[UI verification policy](docs/sdlc.md#ui-approval-scope).

For workflow/OpenSpec changes, use Node 24 and run npm ci for setup, then
npm run check:workflow and npm run test:workflow from the assigned worktree root.
Both checks must exit zero; report the actual specification inventory.
For controller contract changes, use Node 24 and Python 3.12 or 3.14 and run
npm run build, npm run typecheck, npm run test:contracts,
npm run test:contracts:python and npm run test:package from the worktree root.
All must exit zero. Read docs/controller-contract.md before changing wire values,
reference decisions or artifacts.
For MCP changes, read packages/mcp/README.md and run npm run test:mcp,
npm run test:mcp:protocol and npm run test:mcp:package in addition to the shared
build/type/contract/workflow checks. All must exit zero. Report installed-client
and physical acceptance separately from fake service and loopback HTTP tests.
For agent-state changes, read packages/agent-state/README.md and run
npm run test:agent-state, npm run test:agent-state:python and
npm run test:agent-state:package, plus the shared build/type, controller,
lifecycle, MCP and workflow checks from the worktree root. All must exit zero.
Source tests do not qualify a production storage adapter or installed provider.
For controllers/tidbyt changes, read its README and run npm run test:tidbyt and
npm run test:tidbyt:python plus the shared build/type, contract and workflow
checks from the worktree root. All must exit zero.
For apps/hub or apps/dashboard changes, read that app's README and its
validation sections in docs/development.md (for the hub: Standalone hub,
Standalone hub MCP and Shared monitoring setup checks; for the dashboard:
Dashboard checks). Run the listed commands and the shared
build/type/contract/workflow checks from the worktree root. All must exit zero.
Before other product implementation, add the issue-appropriate build/type/test commands
and contract-consumer checks to docs/development.md and CI. Workflow fixtures
alone are not product validation.

Use npm run openspec -- <arguments> with the exact issue-linked change and
local planning root. Initialize with init --tools none --profile core --no-animation.
Before sync/archive, obtain successful current lookups, complete applicable
artifacts/tasks and acceptance evidence, then synchronize every affected spec
and archive on the delivery branch before final review. A conditional design
omission needs its schema-based reason; failed lookups do not justify omission.

## Runtime and migration boundaries

Installation: a merged change to the installed Hub is complete only after
`node apps/hub/bin/hub-install.mjs upgrade <sha>` installs it on the owner's
installation and its receipt, running identity and health are verified. The owner
has given standing installation authority for authorized delivery to this
established installation: after merge and post-merge CI, review the exact plan
and run the upgrade without requesting approval again. A source-only exception
needs the user's narrower scope or an accepted issue with a reason and linked
installation issue; report overall delivery as installation pending. Before
planning, running or checking an install, upgrade or rollback, read [the Hub upgrade procedure](apps/hub/SETUP.md#upgrade-and-roll-back-the-installed-hub)
and run `node apps/hub/bin/hub-install.mjs plan` with its required inputs first.

Provider hooks report allowlisted lifecycle metadata and must fail open without
changing agent permissions or waiting for devices. Keep activity, attention,
notice acknowledgment, optional read evidence and observation freshness distinct.
Do not infer success, readership, parentage or connectivity from missing evidence.

Maintain one active agent-state owner and one designated writer per physical
device. The hub calls existing controllers; it does not bypass their queues.
Keep controller databases private, especially across Windows and WSL. Use
explicit API/ownership handoffs, not concurrent access to a mounted SQLite file.

Preserve legacy Nanoleaf behavior until an explicitly selected and verified
shared-input cutover. Retain task/effect epochs, source reservations, unread
policy, preferences and scenes. Preserve Pixoo's simulator startup, originals,
referenced renditions, playback recovery and explicit Monitor/Media semantics.

Read-only, planning and explicitly source-only work do not authorize runtime
changes. Standing installation authority covers the established target and
documented routine upgrade/recovery procedure with a named installation owner;
it does not authorize new hosts, personal settings, hooks, agent sessions,
unqualified migrations or device commands. Physical tests still need an explicit
device IP and permission for the sequence/display replacement. Never use a guessed target,
change firmware/router/firewall settings or claim physical accuracy from CI,
simulator frames or transport acknowledgment.

Keep credentials, private media, databases and runtime state out of Git. Keep
collected personal data out of Git and every GitHub publication surface,
including private repositories, issue/PR text, logs, artifacts and attachments.
Retain personal data from owner-selected sources privately, including logs and
telemetry; credentials, authentication tokens and secrets remain excluded.
Retained personal data may be used in Claude and Codex prompts, within the
existing collection and sharing choices. This selects no new source. New work
needs no clearing, erasure or retention-expiry features (ADR 0011 amendment,
2026-10-05).
Before changing collection, retention, diagnostics, export or evidence publication,
read [ADR 0011](docs/decisions/0011-private-personal-data-retention.md) for the
collection and sharing boundaries. Use synthetic or sanitized publication copies
without stripping the private originals. Preserve explicit collection/sharing
choices, existing clear/recovery behavior and device authorization. Only fields declared
by the selected versioned contract are transmitted; prompt, response and
transcript-content capture requires its separate implementation under Hub #425.
Preserve explicit-label precedence and neutral fallbacks for untitled sessions.

## Human-facing prose

Use the centrally installed unslop skill as the final editorial pass on
commentary, responses, documentation and authorized GitHub prose. Preserve facts,
commands, contracts, citations and evidence. If unavailable, report it and
continue without fetching, copying or installing it.

## UI video previews and walkthroughs

When producing a UI video preview, recorded demo or automated interactive
walkthrough, make the action causing each view change visible:

- Show a cursor or touch indicator moving to the actual control. Highlight the
  target before activation and show a click or tap pulse when it activates.
- Label each step with the control or action being demonstrated. Pause briefly
  before activation and after the resulting change so viewers can connect them.
- Drive walkthrough transitions through the demonstrated controls. Avoid
  unexplained timed jumps between views.
- Label scripted mockup interactions as a demo; do not present them as evidence
  of live services or recorded user actions.

In interactive walkthroughs, let clicking or typing take over and cancel pending
demo actions. Honor reduced-motion preferences while retaining target highlights
and step labels.

Before delivery, watch the full sequence and verify that the indicator matches
the activated control, the action precedes its result and labels remain readable.
For an interactive version, also check takeover and reduced motion. Videos that
do not demonstrate UI interactions do not need a cursor. This guidance does not
require a preview for every change.

## Work guide maintenance

Use `plan-work` and `deliver-work` only when explicitly invoked. Their shared
documentation checkpoints consume the procedure below; ordinary repository
planning and delivery also follow it within the user's authority.

Read [the guide maintenance procedure](docs/work-guide/README.md) when a task
intentionally changes or publishes the cross-project guide. Refresh its saved
inputs, regenerate the HTML and run the required checks for that guide revision.
Ordinary planning and delivery do not refresh the guide or create a companion PR
solely to record status; no no-impact ledger entry is required. Read-only tasks
do not authorize writes. Keep source completion, guide revision, public
publication and live verification distinct. Public publication requires the
user's applicable finish line.
