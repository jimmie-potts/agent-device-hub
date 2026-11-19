## Why

[#1865](https://github.com/jimmie-potts/agent-device-hub/issues/1865), part of epic [#1896](https://github.com/jimmie-potts/agent-device-hub/issues/1896), replaces the layered agent-session path with one core-owned model that every reader uses. Today one hook event passes through six shapes and two nested state owners before the core publishes a `session/2.0` record. About fifteen readers then reinterpret its overloaded `freshness`, so a session that waits for the owner decays into "?" on the Tronbyt tile. The accepted decisions are on [#1855](https://github.com/jimmie-potts/agent-device-hub/issues/1855#issuecomment-6905384996) (2026-11-16) and on #1865 ([plan](https://github.com/jimmie-potts/agent-device-hub/issues/1865#issuecomment-6981891021) and [open items](https://github.com/jimmie-potts/agent-device-hub/issues/1865#issuecomment-6982008350), 2026-11-18). The root-start correction of [#397](https://github.com/jimmie-potts/agent-device-hub/issues/397) is part of this change.

## What changes

- Hooks build the `lifecycle/2.0` observation directly, and its wire output stays byte-for-byte the same. The core reduces observations itself and stores sessions in its own tables. The 1.x envelope round trip and the nested agent-state owner leave the live path. The retained 1.x packages stay unchanged for their legacy consumers.
- One transition function returns the affected sessions, removals and occurrences of a change, and the core commits them in one transaction.
- A new major version, `session/3.0`, replaces `freshness` and `restartUncertain`. It carries a hub-computed status (a closed class with an open detail token) and separately evidenced work, attention, outcome and relationship claims. Silence makes only work unconfirmed. Questions and recorded outcomes keep their meaning until evidence or expiry.
- One supported-source definition in the contracts package supplies the source types, schema enums and the hook adapter's source check.
- One shared read function in the contracts package is the only way readers interpret a session record. It reads `session/2.x` until the final step and `session/3.0` after it. A shared synthetic case set, including occurrence sequences, runs against the core and every reader.
- A core restart marks running work unconfirmed. New roots start idle (#397). The 128-session limit applies to roots from any source.
- On its first start, the step that moves session data into core tables drops the old session data, the session family's latest-history pointer and pending session publications. It emits no occurrence and runs no automation.
- Readers adopt the accepted policies: Nanoleaf follows the hub's shared status with no session rule of its own, so waiting and unread tasks keep their indication until that status changes, a question has a 30-second priority window over background cards and automatic speech, and MicroDuck loses its blanket session-count rule.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-runtime`: the session core owns reduction, storage, transitions, aging, restart, root starts, capacity and the one-time reset. Writer exclusion rests on the runtime lease and SQLite exclusive locking.
- `bunny-message-profile`: adds `session/3.0`, the supported-source definition, the shared read function and the case set, and retires session freshness.
- `runtime-agent-hooks`: the hook builds the observation with the runtime's own adapter.
- `runtime-dashboard`: session rows and their uncertainty come from the shared status.
- `agent-status-cards`: cards show Unconfirmed for unconfirmed work and Stale only for an unsynced copy, and label edits are blocked only while the copy is not synced.
- `runtime-tidbyt`: the status tile marks only unknown status and unconfirmed work.
- `nanoleaf-module`: the Lines follow the hub's shared status through the shared read function, with no session rule of their own.
- `bunny-pixoo-module`: the Monitor's uncertainty marker follows the shared status.
- `bunny-microduck` and `bunny-reachy`: automatic expression matches opportunities without session freshness or a session count.
- `bunny-companions`: cards, speech and suggestions use opportunity matching and the 30-second question window.
- `bunny-assistant-tasks`: `read_sessions` reports the shared status.

`agent-state-core`, `agent-lifecycle-contract` and `agent-provider-emitters` describe retained 1.x packages. They are unchanged, and [#839](https://github.com/jimmie-potts/agent-device-hub/issues/839) owns their retirement. `lifx-module` and `runtime-codex-desktop` keep their requirement text and adopt the shared read function under the case set.

## Impact

`packages/event-contracts`, `apps/runtime` (hook, core, store, read-receipt helpers, gateway, dashboard) and the session readers in `modules/` change. The live runtime stops importing `@jimmie-potts/agent-state`. Session monitoring state starts empty once. The core restarts on its existing store, and downtime and data loss are accepted (fix forward). Older host releases keep reporting hook observations unchanged. Their read-receipt helpers stop finding records after the switch to `session/3.0` until each host is updated under [#1869](https://github.com/jimmie-potts/agent-device-hub/issues/1869). Several pull requests deliver the change, as `tasks.md` sets out. The last one synchronizes the specifications and archives this change. Installation, client and physical acceptance stay with #1869.
