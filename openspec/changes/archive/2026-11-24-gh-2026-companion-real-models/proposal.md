## Why

Reachy and MicroDuck answer through the labelled synthetic provider, so only B.U.N.N.Y. is usable with a real model. The owner chose generic real models for both companions now, with their personality work later ([#2026](https://github.com/jimmie-potts/agent-device-hub/issues/2026), round 3 of the #505 design). The limits, prompt caching and spend limits that bound the new cost are delivered (#2024, #2047). Part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035).

## What Changes

- Every profile uses the companions section's configured provider and model with its own curated persona: B.U.N.N.Y., Reachy and MicroDuck share the model, effort, key, prices, per-turn limits, prompt caching and the shared spend ledger. No section key, provider or credential is added.
- The configured title model titles every profile's conversations by the #2075 rules, so Reachy and MicroDuck get topic-following titles. Each title check is a paid conversation-level call in the shared ledger.
- The synthetic provider stays the default without a provider and an explicit `provider: synthetic` choice, and then serves all three profiles. A test or harness may still give one profile another provider.
- MicroDuck's audio is quacks only: its English text is its intended meaning, never offered to the voice, and a Speak request for its message is refused. The page shows that note in place of Read aloud.
- The "Demo" labels are removed from the rail's conversation rows, the Conversation header, its note and the Details drawer, which now names the configured model for every profile.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: "Configured model provider" (every profile on the configured provider), "Spoken replies to typed requests" (MicroDuck's quacks-only rule), "Viewport-filling Conversation workspace" (no Demo label) and "Model-written conversation titles" (every profile on a real title model gets titles).
- `runtime-dashboard`: "Conversations in the rail" (no Demo label).

## Impact

`modules/companions` (provider selection and the speech guard in `src/assistant/engine.ts`, section comments in `src/module.ts`, the rail, page and Details in `src/frontend`) and its tests; the rail's styles in `apps/runtime/dashboard/src/shell.css` and the dashboard README; the browser journeys and the `scenario-assistant-task` capture that checked the Demo labels; the companions README, `docs/development.md` and `apps/runtime/UPGRADE.md`. No table, column, section key, event contract, SDK, core or gateway change. Delivery is reviewed integrated source; installation joins the epic's runtime batch.
