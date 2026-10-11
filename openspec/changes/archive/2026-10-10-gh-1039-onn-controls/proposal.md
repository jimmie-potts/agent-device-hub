## Why

[Hub #1039](https://github.com/jimmie-potts/agent-device-hub/issues/1039) needs usable ONN controls through the existing runtime, dashboard and compatible MCP clients. The accepted [controls qualification](../../../../docs/onn-controls-qualification.md) selects one private Google ADB server with a bounded TypeScript client; retained command payloads currently make focused text unsafe to persist.

## What Changes

- Add one configured ONN module with eight fixed keys, standard YouTube/Stremio launch and safe focused text, without submission or macros.
- Reuse SDK registration, private SQLite/outbox, core dispatcher and command feedback; serialize effects and never retry or replay them.
- Show timestamped current-app/connection evidence and qualified seek instructions in module-owned React; use the existing authenticated MCP command tool.
- Omit ONN text from durable command records and refuse its inbox Send again, while retaining private HMAC duplicate identity and outcomes.
- Add focused protocol/module/privacy tests, disposable scenarios, MCP/browser/accessibility coverage and required CI integration.

## Capabilities

### New Capabilities
- `onn-controls`: fixed controls, truthful state/outcomes, private no-replay persistence and module-owned frontend for one ONN.

### Modified Capabilities
- `bunny-runtime`: narrow memory-only ONN text admission while retaining durable duplicate identity and normal tracking.
- `shared-inbox-history`: refuse resend of omitted ONN text before handling the existing item.

## Impact

`modules/onn`, core tracking/inbox, SDK private request-digest helper if needed, root manifests/lockfile, module schemas, disposable scenarios, dashboard tests and CI. External host dependency is Google's qualified ADB; vendor protocol dependency is the qualified `@yume-chan/adb` version. Shared registration remains automatic. Existing modules and ordinary inbox resend retain their behavior. History, recommendations, automatic Skip and exact-title launch are outside this change. Source delivery is batched for installed/physical acceptance under #1044.
