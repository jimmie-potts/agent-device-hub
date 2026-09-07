# Working on the agent device hub

## Start and scope

Read README.md for the actual implementation state. For planning or delivery,
read docs/sdlc.md and the exact GitHub issue. Before changing ownership,
provider contracts, APIs, state, integration or hosting, read docs/architecture.md
and the linked device contracts. docs/roadmap.md links the delivery sequence;
GitHub issues own acceptance criteria, dependencies and status.

This is currently a planning/bootstrap repository. Do not describe the proposed
core, host, adapters, MCP or UI as implemented. Planning/review is read-only unless
the user explicitly authorizes document or tracker changes. Preserve that scope;
planning writes do not authorize implementing the planned features.

## Delivery and validation

Use the centrally installed github-delivery method for implementation/delivery,
code-review for review, and writing-for-agents for persistent instructions.
Compose grill-with-docs for unsettled implementation-changing decisions and tdd
for meaningful executable behavior. Reuse the shared agent-skills catalog;
report missing prerequisites without copying, installing or replacing skills.

Use one coordinating writer and an isolated branch/worktree per deliverable.
Preserve other worktrees, branches, installations and their owners. Deliver
changes through PRs. Independent read-only Standards and Specification reviewers
must inspect the same committed base/head. Missing review, blocking findings or
any missing/unsuccessful configured CI job prevents automatic merge. Recheck
scope, head and base before a squash merge guarded by --match-head-commit.
Never use --admin. Read all merged-revision main CI jobs before issue closure.
UI changes additionally require explicit human approval of the current candidate.

For workflow/OpenSpec changes, use Node 24 and run npm ci for setup, then
npm run check:workflow and npm run test:workflow from the assigned worktree root.
Both checks must exit zero; report the actual specification inventory.
Before product implementation, add the issue-appropriate build/type/test commands
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
