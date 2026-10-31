## Why

The B.U.N.N.Y. conversation delivered by [Hub #46](https://github.com/jimmie-potts/agent-device-hub/issues/46) answers from tools alone: the owner's curated persona and the explicit preferences they already maintain in the companions module never reach the model, so every answer is impersonal and the owner repeats what the module already knows. The owner amended decision 5 on #46 on 2026-10-31 so that the curated `bunny` profile and active explicit preferences may enter the system prompt. This change is the first slice of [Hub #507](https://github.com/jimmie-potts/agent-device-hub/issues/507), under epic [#498](https://github.com/jimmie-potts/agent-device-hub/issues/498).

## What Changes

- Each model call of an assistant task carries, besides the fixed instructions, tool definitions, transcript and Hub mode, the task profile's curated persona (name and character) and the owner's currently active explicit preferences (title and text), read from the module's own store at that call.
- Inactive and historical preferences, knowledge entries, conversation history, other tasks and the private context document stay out of the prompt. No retrieval system, notes collection or structured source is added; those remain #507's later slice.
- The rendered persona and preferences are bounded; an over-bound prompt refuses the model call before dispatch with a capacity outcome whose transcript message names the cause, instead of silent truncation.
- Preferences are rendered as owner data that grants no tool, permission or device authority.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: the configured-provider requirement's prompt-contents rule admits the curated persona and active preferences, bounded, and gains a scenario.
- `bunny-preferences`: the active-only requirement's "never inserted automatically into model context" rule becomes "only active entries enter the assistant's model prompt, read at each call, as owner data".
- `bunny-companion-knowledge`: the curated-personas scenario's "no automatic graph injection" clause is narrowed to knowledge entries and conversation messages.

## Impact

`modules/companions` only: the turn contract and Anthropic adapter (`src/assistant/provider.ts`, `anthropic.ts`), the engine's model call (`src/assistant/engine.ts`, `limits.ts`), the module's wiring of the preference store (`src/module.ts`), their tests, the module README and docs/architecture.md. No event contract, core, dashboard page, container profile or installation changes. ADR 0011 already permits retained personal data in Claude prompts within the existing sharing choices; the installed container's companions section already selects the destination. Source-only delivery; live-model and installed behavior remain with #1320.
