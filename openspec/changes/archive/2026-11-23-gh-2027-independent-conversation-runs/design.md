## Context

The companions engine ran one LangGraph invocation at a time. It held one `#active` run, refused a start while any task was unfinished, and recovered one unfinished task at startup. Every graph node already fenced its work on the task's own generation and abort signal, and every write runs in a synchronous outbox transaction on the SDK's one SQLite connection. The speech coordinator held one active and one pending candidate, and a newer candidate of equal rank replaced the pending one of either kind.

## Goals and non-goals

Goals: each conversation runs its own task and graph invocation, none blocks another, and nothing crosses between conversations. Records that must not cross are checkpoints, limits, spend reservations, cancellation fences, titles, session reports and spoken replies. Recovery is per conversation.

Non-goals: coding-worker slots (#2028), a queue of messages (#2030), steer (#2031), the Apartment room (#2036), real providers for Reachy and MicroDuck (#2026), and any new device-approval guard.

## Decisions

### 1. A running slot per conversation

`#active` becomes a `Map` from conversation ID to the running `Active`. `#activate` refuses with `capacity` when the task's conversation already has a running slot; `#launch`, `#reconcile`, `#execute` and `#activeFor` look up and clear the task's own entry. A start checks only its own conversation: `AssistantStore.unfinishedIn(conversationId)` and the slot. Keying by conversation rather than profile keeps the rule correct when a conversation that is not one profile's (#2032) joins. The state's `tasks` list still holds the latest task per profile, which equals the latest per conversation today.

### 2. One connection, no transaction across an await

Several graphs now interleave on one connection. Every engine write still runs inside one synchronous `outbox.transaction`, and the checkpointer's writes are synchronous after its asynchronous serialization. JavaScript runs one transaction to its end before another starts, so no transaction spans an await and none interleaves with another. Each graph has its own checkpoint thread, the task ID.

### 3. Spend reservations stay atomic

`SpendLedger.reserve` reads the day's and month's totals and inserts the reservation in the caller's synchronous transaction. Two turns' reservations therefore run one after the other against the totals the earlier one left, so together they never pass the daily limit or the month's guard. A new turn's admission check (`reached`) is unchanged, and a refused reservation ends its own turn with its own message.

### 4. Recovery per conversation

`AssistantStore.unfinished()` returns every unfinished task, oldest first; startup reconciles each one separately and starts no run. A recovery that fails leaves only its own conversation unavailable until the next start (review round 1 on PR 2055): its answers, resumes and new tasks are refused `unavailable`, its cancel still works, and the other conversations and the published `available` flag are unaffected. Each failed start saves one assistant message in that conversation, `RECOVERY_FAILED`, saying that its saved progress could not be restored, that the task can be cancelled but new messages there wait until B.U.N.N.Y. restarts, and that the restart tries the recovery again (review round 2). The #2046 closing reply covers only a turn that settles failed or uncertain, so it does not fit a paused task; the message uses the same `-closing-` id prefix, which keeps it out of title prompts. The page cannot tell this pause from a pause while the assistant was unavailable, after which Resume works, from the state it has, so its controls stay as they are; the message says what works. Before, one conversation's unreadable checkpoint made the whole assistant unavailable. Disable uses the same list: any unfinished task refuses it with `invalid-state`, because enable and disable are one switch for every conversation.

### 5. A revision per conversation

The page sends the assistant state's revision with every command. One assistant-wide check refused any command after any change, so another conversation's step made a start, answer or cancel stale (review round 1 on PR 2055). The store now records, per conversation, the assistant revision of its last task change in `assistant_conversation_changes`: `save` marks the task's conversation, a rename marks its conversation (review round 2), and the next `bump` records it at the new revision. A run's trace bookkeeping does not count as a change. A command for a conversation is refused `revision-conflict` only when that conversation changed after the revision it names, or when the revision is ahead of the assistant's. Enable and disable keep the assistant-wide check. Rename is checked against its conversation too, since it is a command for one conversation. No wire change: `expectedRevision` keeps its meaning as the revision the client read. Each start of the engine raises every saved conversation's row to at least the current revision (review round 2), so a command is refused when it names a revision older than the assistant's revision at start, or when its conversation changed at startup, such as a reconciled unfinished task, whatever rows an earlier release left behind. A command naming the revision at start in a conversation that did not change is accepted, as before the start. The first start fills the table that way.

### 6. One waiting reply per conversation

The engine passes each spoken reply's conversation ID as its line. The coordinator keeps Reachy's card slot, with the existing rule that a newer card of equal or higher rank replaces the waiting card, and a map of one waiting reply per line. A newer reply of the same line, a replay included, replaces its waiting reply. Each candidate records its arrival. The voice takes the waiting candidate of the highest rank, then the earliest arrival. The ranking is unchanged: a reply ranks with coding attention, above notices and social speech, and only a strictly higher rank interrupts. Dispatch drops a candidate that went stale or lost its epoch while it waited and takes the next one. Stop, mute, loss and uncertainty clear every waiting candidate, as they cleared the one pending candidate.

### 7. Device approvals

No new guard. A device approval keeps its configuration revision and generation guards and the unavailability and hold refusals, and a mode approval keeps its Hub-mode revision. Each device's single writer applies commands in arrival order and refuses a stale one. A test shows two conversations' mode approvals reaching a fake writer in arrival order.

### 8. The page

The composer blocks a start only while the open conversation's own task is unfinished. The cross-profile "One task is still unfinished" line is gone, so an empty demo now shows the invitation to send a message. While Disable is unavailable, Conversation settings says whether the open conversation has an unfinished task and lists a "Go to <name> task" button for each other one; at narrow widths the button also closes the Details overlay.

### 9. The test seam

`AssistantOptions.profileProviders` gives a test or harness a provider for a profile without a configured one. The qualification test uses it to give all three conversations gated paid providers. The production module passes none, so Reachy and MicroDuck keep the synthetic provider.

## Risks and trade-offs

- With several graphs, a slow model call in one conversation no longer delays the others, but the shared daily limit can now be reached by turns of other conversations. Each refused turn says why.
- The single coding worker still runs one hand-off. While it is busy, another conversation's delegation is not proposed, and the tool result keeps today's wording, "No coding worker is connected right now". That wording is misleading for a busy worker; #2028 owns the slots and the wording.
- `unfinishedIn` scans the unfinished tasks, at most one per conversation; there is no new index or column.

## Migration

The new `assistant_conversation_changes` table is created on first start, and each start raises every saved conversation to at least the current revision. Saved tasks, checkpoints and reports keep their shape. A database from the earlier release has at most one unfinished task, which the new startup recovers as before.
