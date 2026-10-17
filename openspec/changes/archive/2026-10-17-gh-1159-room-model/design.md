## Context

See proposal.md and Hub #1159. Core already owns lighting-layout; the shared Rooms workspace resolves membership and guarded LightCards on one dashboard participant. Module content API 1.3 already serves authenticated non-executable JSON with cancellation and shared refusals. A design is required because private file reads cross the browser/core boundary.

## Goals / Non-Goals

**Goals:** keep model files under the core's existing private files owner, reuse current room IDs and device owners, and make model selection a presentation operation.

**Non-Goals:** an upload/editor service, automatic scan reconstruction, a new module/protocol, new device discovery, command retries, per-zone scene mirroring or photometric simulation.

## Decisions

1. Store `room-models/catalog.json` and `<model-id>.json` under `context.files()` for core. Keep originals in an unserved source folder there. Serve catalog and model references through core content; model reads use module API 1.3. This avoids a second room/state owner or a new asset service. Prepared versioned JSON contains typed position/normal/index buffers and materials, not HTML, scripts, texture URLs or arbitrary external GLB dependencies. Original GLB remains the editing source.
2. Use a bounded manual preparation contract: at most 32 models, 64 anchors, 128 draw batches and 100,000 triangles; each prepared model is at most 2 MiB. Validate before exposing it and again before allocating browser buffers. Read only regular owner-private single-link files through unlinked directories. Requests select IDs, never paths. No cache survives the read, no background polling and no new store migration.
3. Render locally using WebGL, with camera-dependent wall cutaway and stable fixture groups. A React component owns renderer lifetime, resize, pointer cleanup and context loss. Ordinary buttons provide camera and fixture access when WebGL is unavailable. The existing room card stays available if loading fails.
4. Resolve each selected anchor through current room assignments and unique `(deviceId, owner)` evidence. The workspace reuses its existing retained attempt bindings, capability guards and LightCard; it rechecks the binding at action time. Labels are model presentation aliases and never change routing IDs or hardware configuration.
5. Show SDK-reported power/brightness and fresh/stale availability beside each fixture; use a modest mesh emphasis for known power, with an explicit neutral/unknown state otherwise. Color/scene controls remain those declared by each owner; model materials do not claim current per-zone colors or exact illumination.
6. Existing gateway/module content dispatch owns authentication, request-level refusal records and trace continuity. The file reader returns fixed shared refusals and never logs data, paths or raw exceptions. Reads have no effects; existing command/queue/outcome diagnostics remain unchanged. Bad file data does not fail core. Stop/abort fences late bytes. Explicit refresh may read again; no command retry is introduced.

## Risks / Trade-offs

- Manual model preparation can drift from furniture → keep source/calibration private and label inferred dimensions; placement remains editable outside the app.
- A binding can become obsolete → re-resolve against current room/owner membership on every render and before dispatch.
- Invalid geometry can consume memory → limit decoded bytes, vertices/indices/materials and finite bounds before GPU allocation, with a non-3D fallback.
- One selected controller is not currently registered → keep its anchor visibly unbound until owner input or an explicit accepted limit; do not guess targets.

## Migration Plan

No database format changes. Deliver reviewed code and synthetic tests, then use the qualified routine upgrade and preserve existing core files in its stopped-writer backup. Prepare the owner-selected files privately and assign known devices through the existing layout command. Verify build/health, authenticated view and no-command reads before separately selected physical effects. Recovery follows UPGRADE.md; never restore a snapshot or send device commands as a fallback.
