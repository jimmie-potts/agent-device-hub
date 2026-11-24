## Context

See proposal.md for why. Before this change `AssistantEngine.#context` built `{persona, preferences}` at each model call, the engine refused a call whose rendered preferences passed 128 KiB, and the Anthropic adapter rendered both into the system prompt. A profile's conversation was its row in `assistant_conversations`, and `AssistantState.tasks` held each profile's latest task. The knowledge page's context preview read a separate, owner-selected `companion-context/1.0` document for copying elsewhere.

## Goals / Non-Goals

**Goals:** one builder with named sections, fixed order, byte budgets and stated trims; recent messages and tool results of the task's own conversation, fixed when the task starts; a per-companion knowledge switch; New conversation with its own session, title, running slot and change rows; earlier conversations readable; a preview of the builder's own output; identities a follow-up can resolve.

**Non-Goals:** long-term memory content or per-companion personality work (later stories); queue and steer (#2030, #2031); the show proposal (#2041) and the voice investigation panel (#2043), whose code resolves the rest of those follow-ups; any event contract change.

## Decisions

1. **Sections are rendered text in a fixed order.** `buildContext` returns each section's name, budget, state (`included`, `off` or `empty`), counts of items sent and left out, bytes and exact text. Providers place the texts; the preview returns the same objects. Order: personality, knowledge, preferences, memory, recent, then the adapter's mode line. The issue lists memory after recent; it is placed before because it is stable relative to the recent conversation and keeps the cached prefix stable once it holds content (owner-approved).
2. **The recent conversation is bounded by a saved sequence.** A new task saves `contextThrough`, the conversation's last message sequence before its prompt. Each call reads the conversation's saved messages up to it, at most 48 of the newest, then trims oldest first to 48 KiB. Messages saved later, such as an earlier task's late confirmation, wait for the next task, so the section stays the same for the task's calls; a removal still takes effect because removed rows are gone. A task saved before the field has an empty section. Alternative: a snapshot of the text in the task record; rejected because it would keep sending a message the owner removed.
3. **Bounded associations are the saved identities.** Each line names `[message <id>]`; a tool result names its tool from its task's saved transcript; an artwork attachment carries its request ID and description through the same join the history reads use, so #2072's attachment identities arrive by that join. `read_saved_art` adds each artwork's `sourceRequestId` so a follow-up can map an attachment to an artwork ID. Context grants no approval: every command still goes through the existing proposal guards and the owner's approval.
4. **New conversation is a module-private staged input.** `{action: 'new-conversation', profile, expectedRevision}` uses the existing assistant-input upload and command, so no wire contract changes. It names the profile's current conversation's revision, is admitted while conversation is off (it runs no work), and is refused with `invalid-state` while that conversation has an unfinished task or a running slot (owner decision). It moves `assistant_conversations` to a new UUID, records both conversations in `companion_conversations`, and touches both change rows. `AssistantStore.latest()` now keeps only tasks of a profile's current conversation, which holds because no unfinished task can remain behind; session reports, assistant state and the page therefore follow the new conversation. The old session is left idle; native sources cannot end a session.
5. **The knowledge switch is assistant-owned state under a knowledge scope.** `assistant_context_settings(profile, knowledge)` is read at each call; the `set-context-knowledge` knowledge command writes it under the new `context` scope, so it is checked per scope as #2056 does.
6. **Preferences trim instead of refusing.** The issue requires trimming by section budget with the trim stated, never silently, so the 128 KiB refusal and `CONTEXT_TOO_LARGE` are removed.

## Risks / Trade-offs

- [More prompt text per call] → bounded by the section budgets, about 132 KiB in all; the stable sections are cached across calls.
- [A follow-up could act on a stale subject] → the recent section tells the model to check current state and ask when ambiguous; command guards and approval are unchanged; a removed or changed device is resolved again at proposal time.
- [Conversation history goes to a cloud model] → only the configured Anthropic provider receives it, which ADR 0011's 2026-10-05 amendment allows; any other provider needs its own decision.

## Migration Plan

`assistant_context_settings` is created empty, so knowledge stays off. Saved tasks have no `contextThrough` and keep an empty recent section. Returning to the previous release leaves the table and field unread; a profile whose conversation was replaced keeps the new one as its only conversation, and the earlier ones stay in `companion_conversations` and their messages.
