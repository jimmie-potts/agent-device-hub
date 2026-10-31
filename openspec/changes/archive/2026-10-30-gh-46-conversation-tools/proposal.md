## Why

The companions module can retain and resume a synthetic task, but the owner cannot converse with B.U.N.N.Y., ask about status or request an action. [Issue #46](https://github.com/jimmie-potts/agent-device-hub/issues/46) adds the first real conversation under the owner decisions accepted on 2026-10-30: one hosted model, two permitted tools, explicit approval of every state change and no change to who owns devices or modes.

## What Changes

- Add a configured model provider behind the existing one-function seam: the Anthropic Messages API (`claude-opus-5-5`, medium effort, no fallback) reached through the module's own fetch with a transport seam, keyed by a secret the companions section names. Without a section the default stays the synthetic provider, now driven through the same tool-capable turn contract and labelled as synthetic.
- Replace the fixed interpret → clarify → read → compose graph with a bounded loop: a model turn may ask the owner a question, call a permitted read tool, propose a permitted command or finish. Proposed commands pause for the owner's explicit approval, bound to the exact target and the current Hub-mode revision.
- Add the two first tools: `read_sessions`, which summarizes the core's coding sessions from the module's existing synced copy, and `set_mode`, which after approval sends `mode-set` through the core's tracked dispatcher. Tools come from runtime module manifests and core command families, filtered by an allowlist in the private `runtime.json` companions section; the dashboard shows allowed and unavailable tools but grants nothing.
- Add a core responder that forwards an `assistant-dispatch` command from `bunny/modules/companions` to `CoreHandle.dispatch` for allowlisted families only, so an assistant command is one tracked operation with ordinary outcomes, inbox items and history.
- Publish provider, model and allowed tools in the additive `assistant-state` family; record real token usage as the task's usage units; raise the per-task bounds for real turns.
- Turn the Synthetic tasks page into the B.U.N.N.Y. conversation page with approval controls, model and usage facts, and the synthetic path labelled as a scenario. The `bunny` profile alone uses the configured provider; Reachy and MicroDuck keep the synthetic provider.
- Prompts carry only the owner's typed text, tool definitions, tool results and fixed instructions. No preferences or household knowledge enter the prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: bounded execution limits change for real turns; the synthetic task panel requirement is replaced by a conversation panel; new requirements cover the configured provider, permitted tools, owner approval of proposed commands and core admission of assistant commands.

## Impact

`modules/companions` (engine, store, configuration, provider adapter, page), `packages/event-contracts` (additive `assistant-dispatch` family and `assistant-state` fields), `apps/runtime/src/core/companion-part.ts` (dispatch responder), the companions catalog scenarios and browser journey, and the owning guides (companions README, runtime README, architecture, container operator network paths, development checks). No new package dependency, state owner, transport, device writer or installed effect. Installation needs the production profile with device control disabled, which is #568's first step and outside this change.
