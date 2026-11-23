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

`AssistantStore.unfinished()` returns every unfinished task, oldest first; startup reconciles each one separately and starts no run. A failed recovery write still makes the whole assistant unavailable, as before, so every later task is recovered unavailable too. Disable uses the same list: any unfinished task refuses it with `invalid-state`, because enable and disable are one switch for every conversation.

### 5. One waiting reply per conversation

The engine passes each spoken reply's conversation ID as its line. The coordinator keeps Reachy's card slot, with the existing rule that a newer card of equal or higher rank replaces the waiting card, and a map of one waiting reply per line. A newer reply of the same line, a replay included, replaces its waiting reply. Each candidate records its arrival. The voice takes the waiting candidate of the highest rank, then the earliest arrival. The ranking is unchanged: a reply ranks with coding attention, above notices and social speech, and only a strictly higher rank interrupts. Dispatch drops a candidate that went stale or lost its epoch while it waited and takes the next one. Stop, mute, loss and uncertainty clear every waiting candidate, as they cleared the one pending candidate.

### 6. Device approvals

No new guard. A device approval keeps its configuration revision and generation guards and the unavailability and hold refusals, and a mode approval keeps its Hub-mode revision. Each device's single writer applies commands in arrival order and refuses a stale one. A test shows two conversations' mode approvals reaching a fake writer in arrival order.

### 7. The page

The composer blocks a start only while the open conversation's own task is unfinished. The cross-profile "One task is still unfinished" line is gone, so an empty demo now shows the invitation to send a message. Conversation settings lists a "Go to <name> task" button for each conversation with an unfinished task while Disable is unavailable.

### 8. The test seam

`AssistantOptions.profileProviders` gives a test or harness a provider for a profile without a configured one. The qualification test uses it to give all three conversations gated paid providers. The production module passes none, so Reachy and MicroDuck keep the synthetic provider.

## Risks and trade-offs

- With several graphs, a slow model call in one conversation no longer delays the others, but the shared daily limit can now be reached by turns of other conversations. Each refused turn says why.
- The single coding worker still runs one hand-off. While it is busy, another conversation's delegation is not proposed, and the tool result keeps today's wording, "No coding worker is connected right now". That wording is misleading for a busy worker; #2028 owns the slots and the wording.
- `unfinishedIn` scans the unfinished tasks, at most one per conversation; there is no new index or column.

## Migration

None. Saved tasks, checkpoints and reports keep their shape. A database from the earlier release has at most one unfinished task, which the new startup recovers as before.
