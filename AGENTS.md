# Working on the agent device hub

## Start and scope

Read the README sections relevant to the task for current implementation state
and setup. For planning or delivery, read docs/sdlc.md and the exact GitHub
issue. Before changing ownership, provider contracts, APIs, state, integration
or hosting, read docs/architecture.md and the linked device contracts.
GitHub issues own the delivery sequence, acceptance criteria, dependencies and
status; do not copy issue lists or dependency chains into repository docs.

For planning, edits or review under controllers/tidbyt or controllers/lifx,
read that directory's README.md and AGENTS.md before working there, even when
launched from the repository root. controllers/tidbyt holds the fake-tested cloud
controller package; controllers/lifx contains documents only. For Tidbyt changes,
run npm run test:tidbyt and npm run test:tidbyt:python plus the shared build/type,
contract and workflow checks from the worktree root. Before shared package, root manifest, lockfile or CI changes, read
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

Use one coordinating writer and an isolated branch/worktree per deliverable.
Preserve other worktrees, branches, installations and their owners. Deliver
changes through PRs. Independent read-only Standards and Specification reviewers
must inspect the same committed base/head. Missing review, blocking findings or
any missing/unsuccessful applicable CI job prevents automatic merge.
Only changes entirely under docs/work-guide/ may use the intentional CI-filter
exception in docs/sdlc.md; read its evidence requirements before merge or closure. Recheck
scope, head and base before a squash merge guarded by --match-head-commit.
Never use --admin. Read all applicable merged-revision main CI jobs before issue closure;
for a guide-only filtered revision, record the docs/sdlc.md exception evidence.
UI changes to the cross-project work guide under docs/work-guide/, including
its generated HTML and architecture viewers, do not require human approval.
All other UI changes require explicit human approval of the current candidate,
renewed after changes to that UI. Mixed changes retain approval for UI outside
the guide. Read the [UI approval scope](docs/sdlc.md#ui-approval-scope) for the
boundary and evidence.

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

Source work does not install hooks, change personal settings, launch agent
sessions, migrate live state or contact devices. Installation requires an
explicit request and named owner. Physical tests also need an explicit device IP
and permission for the sequence/display replacement. Never use a guessed target,
change firmware/router/firewall settings or claim physical accuracy from CI,
simulator frames or transport acknowledgment.

Keep credentials, private media, databases, agent metadata and runtime state out
of Git. Shared payloads use user-chosen labels or neutral IDs; do not export
prompts, transcripts, tool content, automatically copied titles or private paths.

## Human-facing prose

Use the centrally installed unslop skill as the final editorial pass on
commentary, responses, documentation and authorized GitHub prose. Preserve facts,
commands, contracts, citations and evidence. If unavailable, report it and
continue without fetching, copying or installing it.

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
