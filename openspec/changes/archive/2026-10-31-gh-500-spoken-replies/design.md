## Context

See proposal.md. The speech coordinator holds one selected connection-bound endpoint, one active utterance and one pending candidate, saves responsibility before output, and speaks only newly admitted live Reachy cards; its candidates carry a card whose opportunity drives policy, deadline and deduplication. The browser session speaks the card's text through the qualified local voice and reports ordered receipts. The assistant engine saves every message that ends a turn (`<task>-result`, a question id, `<step>-refusal`, `<step>-context`) inside its outbox transaction, and the Conversation page reads saved messages by sequence without ids. Assistant controls enter through the core's tracked dispatcher.

## Goals / Non-Goals

**Goals:** a typed request's answer, question or refusal is spoken once through the existing endpoint; the owner can hear a saved answer again; Stop never cancels a task; a newer reply replaces a stale pending one; Quiet keeps replies silent; the voice is independent of the provider; nothing new reaches logs, spans or public state.

**Non-Goals:** push-to-talk, microphone, a second endpoint or voice route, speaking failures that saved no message, speaking tool results, a realtime voice service, and any change to the ambient-capture hold (#642).

## Decisions

- **A second speak shape, not a synthetic opportunity.** `companion-speech-output` gains `{action: speak, reply: {taskId, messageId, text, validUntilMs}}` beside the card shape, and the coordinator's candidate becomes a card-or-reply source. Alternative: wrap the reply in a fake live opportunity with a new category. Rejected: the opportunity contract requires qualified coding metadata, and the card path's dedup, policy and content rules would have to be faked rather than skipped.
- **Reply rank equals coding attention.** A reply answers the owner's own request, so it preempts a notice or social card after confirmed cancellation and waits for an active equal; a newer pending reply replaces an older one at equal rank, which is the existing pending rule. The coordinator's one-active, receipt, uncertainty and no-automatic-replay rules apply unchanged.
- **Policy for replies: Quiet and a synced mode only.** `replyRefusal` needs the synced Hub mode and refuses Quiet. Reachy's text enablement and category mutes stay Reachy's; the endpoint's Stop and mute remain the owner's speech controls. Both the module and the browser's final check apply the same function.
- **The engine offers, the coordinator decides.** `AssistantOptions.speak(reply, key, parent)` is called after the message is durable, with the message id as key for a turn-ending message and `messageId:requestId` for a replay. Text over 512 characters (the driver's bound) is not offered rather than cut. Startup reconciliation never offers, so an answer the owner did not just ask for is not spoken after a restart.
- **Replay as an assistant control.** `assistant-control` gains `speak` with `taskId` and `messageId`; it reads the saved message, admits only assistant text, works for finished tasks, and is idempotent per request id through the existing receipt. The conversation page exposes message ids for it.
- **One set of controls, named for the page.** The Conversation page mounts the existing speech controls with reply wording and its own live Reachy copy for the card policy, so enabling there makes that tab the single speaker for replies and alerts alike.

## Risks / Trade-offs

- [Reply spoken in another tab] → the endpoint is one per connection; the Conversation page explains that enabling makes that tab the speaker, and the Reachy tab shows another tab has speech.
- [Long answers unheard] → the model instructions ask for one to three short sentences; the page says replies over the bound stay written and the Speak button is disabled for them.
- [A spoken answer that sounds final for a queued command] → the spoken text is the saved result the owner reads, which already reports an accepted command as tracked separately; speech adds no wording.
- [Old audio after a new answer] → pending replacement at equal rank, a sixty-second deadline and the coordinator's key dedup.

## Migration Plan

Source-only; no state or configuration change. Existing speech endpoints keep working; the conversation page's saved messages gain an `id` field additively. Rollback is reverting the change.
