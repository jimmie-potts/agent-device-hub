## Context

See proposal.md for why. The queue of #2030 saves the owner's messages for after a task and starts each in the commit that ends the task before it. Each conversation has its own running slot (#2027); the context builder fixes the recent conversation when a task starts (#2029), so a steer must reach the model through the task's own transcript; a hand-off can wait for its companion's slot (#2028); titles are checked after each task and major event, never at a start (#2075); and each model call reserves and counts against the turn's limits and the spend limits (#2024).

## Goals / Non-Goals

**Goals:** Send steers a running task without stopping it; the steer is durable at once and read exactly once, after the last call's tool results; no steer is ever dropped; Skip question and send and Decline with message in one step; a delegation wait keeps the steer; the cancellation fences, per-turn limits, revision checks, at-most-once queued starts and the restart rule hold.

**Non-Goals:** editing or withdrawing an unread steer before the task reads it; steering a paused or uncertain task; any change to `assistant-input` or `assistant-control`; showing steers on the status devices.

## Decisions

1. **A steer is queue-store state.** `assistant_steers` holds each unread steer with its task, conversation, position, text, time and trace, beside `assistant_queued_messages`, keyed by the steering command's request ID. The input command completes once it is saved (ADR 0012), and the shared receipt table makes a repeat save nothing. Admission never bumps the task's generation, so the cancellation fence stays the Stop and deadline path only.
2. **Drain in the model call's admission.** Following Codex's `run_turn` (`turn.rs`, pending input drained before the next request), the engine takes the unread steers into the transcript inside the admission transaction of the next model call, before the limits are checked and the request's budget is computed, and builds the request from that transcript. A call the limits refuse rolls the drain back, so the steers stay unread and return at the close. A replayed `turn` node whose call was admitted finds the receipt and takes nothing, so LangGraph's re-run of a node never reads a steer twice or reads one the replayed answer never saw. Each steer is saved as an owner message in the conversation there, in the task's turn.
3. **Forced follow-up by a receipt flag.** Codex follows up when pending input exists after sampling (`turn.rs`, `needs_follow_up`). The engine records on the model call's receipt, in the transaction that saves its answer, whether unread steers exist. A final answer with the flag is saved as a superseded reply, not spoken, and the node routes to itself through the new `turn → turn` edge; the next call reads the steers. The flag is durable, so a replayed node decides the same way.
4. **The close decides atomically.** In the transaction that ends a task, before the queue's dispatch, unread steers move to the head of the queue in order, so a steer that arrived after the last call's answer starts as the next queued message, with the earlier turn's end reported first. Cancel moves them the same way and then holds the queue. Unlike Codex's `on_task_finished`, which lets a racing steer continue the turn, the owner chose a new turn here.
5. **Expected turn.** A steer names the turn the page expects, as Codex's `expected_turn_id` (openai/codex@a0436d69, `turn_input.rs` `steer_input`). The conversation's unfinished task accepts it. An ended turn that is still the conversation's latest takes it as the next queued message, the same outcome as decision 4, so a page a moment behind loses nothing. Any other turn is stale: `invalid-state`, no retry. The revision only refuses one the assistant has not reached; the task's own steps never make a steer stale.
6. **Questions.** A clarification is answered from the composer; Skip question and send answers it with the fixed `SKIPPED` tool result and saves the steer, and the task resumes in the same commit. An approval queues free text (owner decision 4); Decline with message answers it `decline` and saves the steer in one commit, and stays the title's approval event. A delegation is answered by the worker only, so the steer waits until the worker's result, also while the hand-off waits for its slot.
7. **Limits.** A steer is queued when fewer than two model calls remain, by call count, active time at a call's six-minute deadline and units at the least a call reserves, so the steer gets its call and one more. A task holds at most 8 unread steers, and its steers and the queue together at most 16, so the queue a Stop returns them to never passes 16. Queue stays refused at 8 or more (owner decision), and `assistant-state/2.3` raises the published count's bound to 16, published only past 8.
8. **Graph version.** The new edge makes the graph `conversation-2`. Its nodes, state channels and checkpoints are those of `conversation-1`, so each start upgrades unfinished `conversation-1` tasks before reconciling them; their saved checkpoint continues. Other versions keep the existing unavailable recovery.

## Risks / Trade-offs

- [A steer during an approval is queued, not read by the task] → owner decision 4; Decline with message steers instead.
- [An unread steer of a paused task waits for Resume] → a restart starts no work; Cancel returns it to the queue.
- [Superseded replies add conversation lines] → they are saved for the record, labelled on the page and never spoken.

## Migration Plan

`assistant_steers` is created empty at the first start, and unfinished `conversation-1` tasks are upgraded to `conversation-2` in place. A return to the release before sees `conversation-2` tasks as an unsupported graph and recovers them unavailable, which the owner can only cancel, and ignores unread steers; finish or cancel unfinished tasks before going back. Prefer fixing forward.
