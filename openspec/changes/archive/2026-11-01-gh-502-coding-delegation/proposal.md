## Why

The B.U.N.N.Y. conversation installed by [Hub #1320](https://github.com/jimmie-potts/agent-device-hub/issues/1320) can read sessions and set the Hub mode, but the owner's daily coding work still starts by hand. [Hub #502](https://github.com/jimmie-potts/agent-device-hub/issues/502) lets the owner hand one bounded coding task to a qualified harness through B.U.N.N.Y. and get a reviewable result back. The owner accepted the first slice on 2026-11-01: Claude Code headless on the Mac, a host-local worker, an allowlisted repository in a fresh worktree, worktree-only permissions with no push, a structured result, bounds, and no live approvals.

## What Changes

- Seven `coding-*` families: the worker's endpoint control, the module's dispatch to the core, the core's tracked run to the module, the module's work command to the worker, the worker's progress occurrences, the gateway's lost-endpoint occurrence and the module's coding state.
- A `coding-worker` credential role bound to `bunny/parts/coding-worker` with no scopes; the edge grants it exactly one connection-bound endpoint (respond `coding-work`, publish `coding-progress`, request `coding-endpoint`), and the gateway reports a lost endpoint and refuses direct `coding-*` dispatch.
- The core forwards `coding-dispatch` from the companions module through its tracked dispatcher as `coding-run`; the module's coding coordinator saves responsibility, sends one start to the worker and reports the tracked outcome when the worker starts.
- The assistant gains `delegate_coding` (command effect): a proposal bound to the coding state revision, owner approval, dispatch, then a delegation wait that the worker's result answers as the tool's result; the owner cannot answer it, and cancelling the task asks the worker to stop.
- A host-local worker program (`apps/runtime/bin/coding-worker.mjs`) that reads private configuration, declares its endpoint, creates a worktree from `origin/main` of an allowlisted repository, runs `claude -p` with the structured-output schema, permission mode, tool allowlist, turn and budget caps, observes git facts itself and reports progress.
- The Conversation page shows delegation proposals, the waiting state, the worker's availability and the result text.

## Capabilities

### New Capabilities

- `bunny-coding-delegation`: worker credential and endpoint, tracked dispatch, one operation at a time with bounds, truthful progress and settlement, the host worker's conduct.

### Modified Capabilities

- `bunny-assistant-tasks`: permitted tools gain `delegate_coding`; owner approval covers delegation proposals bound to the coding state revision; the delegation wait and its result; the conversation panel's delegation surface.

## Impact

`packages/event-contracts` (families, types, fixtures, tests), `apps/runtime` (credentials role, edge access, gateway, core companion part, worker program and launcher, tests), `modules/companions` (coding coordinator and store, engine, tools, synthetic provider, module wiring, page, tests), docs (companions README, a worker guide, architecture note). No container profile, image or installation change in this slice; installation of the worker on the Mac and the first real delegated task are separate installed work under the owner's installation authority.
