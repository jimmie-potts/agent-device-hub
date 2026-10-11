## Context

See proposal.md and the accepted ONN controls contract. The module/dispatcher/gateway/frontend seams already exist. Current core operations retain input for inbox Send again; focused text may contain credentials and needs the accepted narrow exception. The schema requires this design because external transport, cross-owner admission, timing, privacy and durable state change.

## Goals / Non-Goals

Use one fixed private ADB socket and serial, one ONN writer, existing core tracking and SDK outcomes. Keep text memory-only while retaining semantic duplicate identity. Production viewing-history collection, native metadata helpers, discovery, fallback, automatic Skip and arbitrary shell APIs are excluded.

## Decisions

- `modules/onn` owns configuration, three command schemas, `onn-state/2.0`, transport, queue, SQLite and React. Automatic registration/build collection avoids a shared module registry edit. API 1.3 pages and read tools use existing authentication; controls use `core_send_command`.
- Keep `@yume-chan/adb` at the qualified version. Use a small Node Unix-socket connector whose readable stream closes on socket errors and whose signal covers every connection and shell operation. Validate the private dependency before use; never launch/discover/repoint a host ADB server. Fixed LEANBACK resolver output is validated; launch once without appended Home or fallback. Safe text is shell-quoted inside the protocol, not host argv.
- The queue commits admission before returning accepted, records started before effect and completes through the existing SDK Outbox transaction. It holds sixteen accepted pending jobs, expires queued work and settles restart stages without running stored input. Read-only device polling has its own bounded loop; state and outcome commits share one serialized storage boundary.
- Core admission recognizes only the exact ONN text key/type/schema, stores empty input with an omitted marker and private HMAC, and sends the live original once. A stable random independent key in the core private folder has a database-pinned identity; missing/replaced/unsafe keys refuse. The same small SDK private-digest primitive may be reused by the module journal. Normal payload retention remains unchanged. Inbox refuses omitted Send again before its handling transaction.
- State exposes neutral app names, timestamps and routing/configuration identity; stale evidence becomes unknown. There is no public ONN settings page. Socket, address, key and raw package names stay private. Logs and outcomes use fixed registry text and metadata; private originals never enter publication evidence.

## Risks / Trade-offs

- [ADB reply can be lost after an effect] → mark uncertain after the effect boundary, retain fence, never retry.
- [A shortcut acknowledgment can be misleading] → resolve exact installed launcher, inspect bounded Android status, keep transmitted distinct from physically observed.
- [Text privacy can fail through an adjacent record] → exercise actual dispatcher/store/WAL/outbox/inbox/gateway/browser surfaces with synthetic sentinel input and negative controls.
- [A key can be removed/replaced] → verify file ownership/mode/type and pinned digest before sensitive admission; preserve fences and report unavailable.
- [App focus is not known] → show timeline/text prerequisites and send only the explicit single requested action.

## Migration Plan

This new module is unconfigured by default and creates only its own tables/files; the core adds private metadata without rewriting other command data. Source delivery includes compatible recovery tests and preserves latest private state. Installation uses the current qualified runtime procedure under #1044; pairing, activation and physical tests get their own bounded sequence authority. No transfer or cutover is introduced.
