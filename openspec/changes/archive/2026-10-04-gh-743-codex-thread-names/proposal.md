## Why

The [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) owner trial (epic [#738](https://github.com/jimmie-potts/agent-device-hub/issues/738)) found that Codex focus can almost never verify. The router compares the selected Codex sidebar row with the slot's last-known title, and that title comes from the Hub. The Hub carries a Codex title only when the owner set one, so most Codex slots fail closed with `title-missing` before anything opens. Codex itself keeps every thread's sidebar name in its local `session_index.jsonl`. The owner chose to have the bridge read Codex's own names locally.

## What Changes

- The Windows adapter reads Codex's own thread name for a thread ID from `session_index.jsonl` in the Codex home (only `id`, `thread_name` and `updated_at`; the newest entry wins) and compares the selected row with it, falling back to the Hub title when Codex has none.
- OS adapter interface version 2 replaces `codexSelectedTitle(title)` with `codexSelectedThread(threadId, fallbackTitle)`. Names stay inside the adapter; only a boolean and a count cross it.
- The router no longer fails a Codex press at the target check for a missing Hub title. With neither name the verification fails closed as `title-missing`.
- README, UI Automation notes and the routing design in the qualification report describe the new source.

## Capabilities

### Modified Capabilities

- `chompi-task-routing`: Codex selection compares the thread's Codex name, else the Hub title.
- `chompi-bridge`: the OS adapter contract becomes version 2 with the thread-based Codex selection.

## Impact

Bridge package only; no Hub, agent-state, lifecycle or controller-contract change, and the Hub's title rules are unchanged. The bridge reads one more Codex file locally and never logs, stores or sends the names. Installation and the live check belong to #743's trial.
