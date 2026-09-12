# Working on the agent device hub

## Start and scope

Read README.md for the actual implementation state. For planning or delivery,
read docs/sdlc.md and the exact GitHub issue. Before changing ownership,
provider contracts, APIs, state, integration or hosting, read docs/architecture.md
and the linked device contracts. docs/roadmap.md links the delivery sequence;
GitHub issues own acceptance criteria, dependencies and status.

For planning, edits or review under controllers/tidbyt or controllers/lifx,
read that directory's README.md and AGENTS.md before working there, even when
launched from the repository root. These directories currently contain documents
only. Before shared package, root manifest, lockfile or CI changes, read
docs/development.md and coordinate with the owner of concurrent shared work.

Controller contracts, pure TypeScript/Python conformance consumers and reusable MCP are implemented.
Do not describe the proposed core, standalone host, adapters or UI as implemented. Planning/review is read-only unless
the user explicitly authorizes document or tracker changes. Preserve that scope;
planning writes do not authorize implementing the planned features.

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
UI changes additionally require explicit human approval of the current candidate.

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

For every authorized delivery or planning change, read
[the guide maintenance procedure](docs/work-guide/README.md). Update the affected
inputs, regenerate the HTML and record the result in `docs/work-guide/updates.md`
before completion. Record a specific no-impact reason when no represented fact
changes. For cross-repository work, identify the coordinator and linked hub
companion PR; pending synchronization remains explicit in the completion report.
Read-only tasks do not authorize writes.
Keep source completion, guide synchronization, public publication and live
verification distinct. Tracker-only planning reports the latter stages pending;
public publication requires the user's applicable finish line.
