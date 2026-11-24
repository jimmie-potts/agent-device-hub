## Why

The coding worker ([Hub #502](https://github.com/jimmie-potts/agent-device-hub/issues/502)) runs one task at a time: the worker refuses a second start with `capacity`, the companions coordinator holds one active operation and `coding-state/2.1` has one `active` entry. A proposal binds to the coding state revision, so another companion's run starting refuses an unrelated approval with `revision-conflict`, and while the worker is busy the model is told "No coding worker is connected". Epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035) gives each companion its own task. The owner chose W1 to W4 (round 5 on #505) and, on [#2028](https://github.com/jimmie-potts/agent-device-hub/issues/2028) ([decisions](https://github.com/jimmie-potts/agent-device-hub/issues/2028#issuecomment-7133282507)), that a hand-off whose slot is busy is still proposed and, once approved, waits and is sent when the slot frees; that a never-sent waiting hand-off keeps its place across a restart; and that slots are fixed, one per companion.

## What Changes

- One worker process with three slots, one each for B.U.N.N.Y., Reachy and MicroDuck. The worker declares `slots: 3` in `coding-endpoint/2.2`, takes one run per companion and at most three at once, and refuses another with `capacity`.
- Each start is tagged with the companion that asked (`coding-work/2.1`). The module reads the companion from the task. An older worker that declares no slots holds one run for every companion and receives the untagged 2.0 start.
- `coding-state/2.2` adds the declared `slots`, every active run with its companion in `runs`, and the approved hand-offs waiting for a slot in `waiting`, oldest first. `active` stays the oldest run for older readers.
- A delegation proposal binds to the worker's connection and endpoint only. Runs starting and ending, and readiness reports, never move it, so another companion's run never refuses an approval. A changed or lost endpoint still refuses it with `revision-conflict`.
- A hand-off is proposed while a worker is connected, even if the companion's slot is busy; the page's approval text says so. An approved hand-off whose slot is busy, or has a line, waits durably, first in first out per slot, and is dispatched once through the core's tracked dispatcher when the slot frees. Cancel removes a waiting hand-off and sends nothing. A never-sent waiting hand-off keeps its place after a restart; one whose dispatch had left without its acceptance recorded is uncertain at the next start and never sent again.
- Runs on the same repository each get their own fresh worktree; their git setup takes turns.
- Cancel, a timeout, a lost worker and a restart each settle only their own operations. Nothing is resent; an unanswered run stays uncertain. A lost endpoint frees the worker's slots for its next endpoint at once, and a stopped run's report never goes out on the new one.
- The Conversation page shows the worker's slots, the companion's own slot, the shared plan usage windows from readiness, and a waiting hand-off as "Waiting for the coding worker: it is busy…", never as not connected.
- Unchanged: the worker's credential role and three families, its deny list and worktree rules, per-run caps (20 minutes, 60 turns, $5), refusals and the tracked `coding-run` outcomes (ADR 0012), owner approval of every hand-off in its own conversation, #2075's title checks on hand-off acceptance and result, and its no-check settlement at start, per run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-coding-delegation`: "Worker credential and endpoint" (slots declaration, per-run loss) and "Tracked dispatch and one operation at a time", renamed "Tracked dispatch and one slot per companion".
- `bunny-assistant-tasks`: "Owner approval of proposed commands" (binding to the worker connection, waiting hand-offs) and "Conversation panel" (slots, plan usage, busy wording).

## Impact

`packages/event-contracts` (three additive minors: `coding-endpoint/2.2`, `coding-work/2.1`, `coding-state/2.2`), `apps/runtime/src/worker`, `modules/companions` (coordinator, store, engine delegate seam, module wiring, Conversation page) and their tests; docs/coding-worker.md, the companions and event-contracts READMEs, docs/development.md and apps/runtime/UPGRADE.md. The companions store gains the table `companion_coding_waiting`. Upgrade the core before the worker: an older core refuses `coding-endpoint/2.2`. Delivery is reviewed integrated source; the installed worker update joins the epic's runtime batch. Until New conversation (#2029) a companion has one conversation, so a companion's own second hand-off is tested at the coordinator level; another companion's wait behind an older worker's one slot is tested through the module and page.
