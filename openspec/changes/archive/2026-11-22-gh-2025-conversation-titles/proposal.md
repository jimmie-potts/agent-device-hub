## Why

Native B.U.N.N.Y. conversation sessions are titled by persona, so every conversation of a profile reads the same on the status devices. Claude Code and Codex title their sessions with short model summaries. [#2025](https://github.com/jimmie-potts/agent-device-hub/issues/2025), under epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), gives each conversation a short model-written title led by its GitHub issue, as the owner chose in rounds 2 and 3 on [#505](https://github.com/jimmie-potts/agent-device-hub/issues/505): sentence case after the issue number, another repository's issue as `repo#n`, the main issue when several appear.

## What Changes

- After the first message of a session appearance, at its third task, and when the session reappears after a day without evidence, a small model call writes the conversation's title. The default title model is `claude-haiku-5-5`, configurable as `assistant.titleModel` in the private companions section.
- The title instruction and normalization are adapted from OpenAI Codex (Apache-2.0) and T3 Code (MIT), with their license and notice text in `modules/companions/THIRD-PARTY-NOTICES.md`.
- The title is stored on the conversation with its source and published as the session title. Until one exists the persona name stands. A failed, refused or invalid title never fails or rolls back a task.
- The owner renames a conversation from Conversation details through the additive `assistant-control/2.1` action `rename`. A generated title never overwrites it, and a title call in flight is dropped when it lands.
- `lifecycle/2.3` allows the native producer's `metadata-observed`, so a title change reaches the devices at once without waiting for other activity. The core accepts it from the companions module only.
- Each title call is recorded on its conversation with its reported usage, outside every task's limits, for the spend accounting of [#2024](https://github.com/jimmie-potts/agent-device-hub/issues/2024).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-assistant-tasks`: conversation sessions carry the conversation's title; model-written titles and owner rename.
- `bunny-message-profile`: `lifecycle/2.3` and `assistant-control/2.1`.
- `bunny-runtime`: the core takes native title metadata; the gateway sends a rename as `assistant-control/2.1`.

## Impact

Contracts (`packages/event-contracts`), the core's lifecycle intake and the gateway's command versions (`apps/runtime`), the companions engine, provider adapter, configuration and Conversation page (`modules/companions`), and the companions browser journey. Claude and Codex session titles stay as they are (later work). Installed and live-model acceptance join the epic's installation batch under [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869).
