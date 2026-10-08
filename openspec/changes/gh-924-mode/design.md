## Context

Hub #924 fills the existing home slot. The core already owns a SQLite store, transaction outbox, dispatcher, outcome tracker and operation projection. Nanoleaf and Pixoo own their native device writers. The coordinator owns shared integration while #923 adds the real inbox.

## Goals / Non-Goals

**Goals:** one durable selection, explicit fixed fan-out, independent outcomes, existing control scope, and recovery without replay.

**Non-Goals:** another state owner, scheduler, retry system, per-device override, LIFX participation, migration, companion control or physical acceptance.

## Decisions

- Add a `ModePart` using `CorePart` and its own singleton row in the core store. Initialize Free once; reads and startup do not apply it. Save, revision comparison, outbox state and tracker completion share a transaction.
- Inject private admit/complete/end functions bound to the existing tracker. Keep `mode-set` on normal dispatch. Create a tracker admission for this family while retaining the dedicated operator authorization comparison and exact raw responder binding. No public SDK privilege is added.
- Retain qualified device IDs from host admission on the internal hosted-module record. A plain helper selects admitted Nanoleaf/Pixoo modules regardless of stopped/failed state. Assign this fixed list once after startup and before serving the gateway; assignment sends nothing.
- After commit, concurrently dispatch each native command through `CoreHandle.dispatch`, using the existing `nativeMode` mapping. Deterministic child request IDs bind each participant to the parent request without copying private payloads into published operation records.
- Use the existing authenticated browser action and MCP extension paths. Sync the mode and operation families on the dashboard's existing connection. The saved record proves only the selected mode; operation evidence reports device results. Failed/uncertain results remain the inbox's responsibility.
- Keep the existing bounded operation retention. After its evidence retires, the panel reports that no result is observed rather than inferring success. Startup never reconstructs or sends missing child commands.

## Risks / Trade-offs

- A crash after saving but before sending leaves the selection saved with absent device evidence. This is deliberate: restart does not reconstruct or replay commands, and absent evidence never becomes success.
- The mode contract has no application request ID. The panel associates the latest successful mode-set operation with deterministic child IDs, and retires that association when a newer saved selection is not covered by the available operation evidence.
- Fixed targets include stopped modules. Their commands may fail or become uncertain; other targets proceed and the inbox records each problem.
- Shared integrations and runtime/browser evidence wait for #923 and the coordinator's host-slot assignment. Unit checks alone do not claim integrated, installed or physical acceptance.

## Migration Plan

No data import or cutover occurs. A new core table starts Free; later starts retain it. Removing this source feature leaves the private table intact. Installed migration and acceptance belong to #840.
