## Context

See proposal.md. The engine's model call builds a turn from fixed instructions, the task transcript, the permitted tools and the synced Hub mode; the Anthropic adapter renders those into one `system` string and the synthetic provider ignores the instructions. The preference store already exposes `active()` (current active entries without history, in creation order), and the knowledge library already assembles an explicit, bounded context document from the curated `PROFILES` constant and those active entries for the owner to copy. The module constructs the assistant engine before the preference engine, and the knowledge engine depends on both. ADR 0012 keeps prompts out of logs, spans and public records; ADR 0011 permits retained personal data in Claude prompts within the existing sharing choices.

## Goals / Non-Goals

**Goals:** the persona and active preferences reach every model call as current data, read at the call so edits and Stop using apply to the next turn; the prompt stays bounded with an honest refusal; preference text is framed as data that grants nothing; nothing new reaches public state, logs or spans.

**Non-Goals:** knowledge entries, conversation history, the private context document or other tasks in the prompt; retrieval from notes or a structured source (#507's later slice); a persistent context cache; any change to the preference lifecycle, documents, dashboard pages, event contracts or the core.

## Decisions

- **Structured context on the turn contract, rendered by the provider.** `TurnInput` gains `context: {persona: {name, character}, preferences: [{title, text}]}`; the Anthropic adapter renders it into the `system` string after the fixed instructions and before the mode, under a sentence stating the preferences are the owner's data and grant no tool or permission. Alternative: the engine concatenates one `instructions` string. Rejected: a provider knows how to place system content for its API, and tests can assert on structure rather than on a rendered string.
- **Read at each model call through a seam.** `AssistantOptions.preferences?: () => ActivePreference[]` is supplied by the module from the preference store, so the engine stays testable with a fake and the knowledge engine's dependency on the assistant engine is unchanged. The module constructs the preference engine before the assistant engine; both only open stores on the shared connection, so the order has no other effect. Alternative: snapshot the preferences at task start. Rejected: the owner expects Stop using to apply to the next turn, as the context document already behaves.
- **Persona from the curated constant.** The task profile's persona comes from the existing `PROFILES` constant in the knowledge model (name and character only); the voice reference and audio kind stay out. Each profile gets its own persona; only `bunny` reaches a hosted provider today, and the synthetic provider ignores the context.
- **Bound of 16 KiB on the rendered context, refused not truncated.** `LIMITS.contextBytes = 16_384`, the existing reply bound. The engine measures the rendered titles and texts before reserving usage or dispatching; over the bound it records a transcript message naming the bound and fails the call with `capacity`, the existing code for an exhausted limit, so the task ends visibly and the dashboard's mode controls keep working. Alternative: include preferences up to the bound in creation order and note the omission. Rejected: the module's existing rule is to refuse a large context rather than truncate it, and the owner can act on a named cause.
- **No new records.** The prompt context is derived at the call and never stored; receipts, spans, logs and public state are unchanged, and the existing tests that assert no prompt text in those places extend to preference text.

## Risks / Trade-offs

- [Preference text as a prompt-injection vector] → rendered under a fixed framing sentence as owner data; tool permission is enforced by the engine's allowlist and the core's dispatcher, never by prompt content; a test asserts a preference that reads like an instruction does not widen the permitted tools.
- [An owner with many long preferences loses the conversation] → the failure names the bound and the Preferences page's Stop using control; the bound equals the reply bound and fits roughly forty typical entries.
- [Token cost rises with every preference on every call] → bounded above by 16 KiB (about four thousand tokens) and visible in the call's usage units; the #504 readout will show it.
- [Inconsistent ordering between calls] → creation order from the store, the same order the context document uses.

## Migration Plan

Source-only; no schema, state or configuration change. Existing tasks continue; the next model call of any task includes the context. Rollback is reverting the change.
