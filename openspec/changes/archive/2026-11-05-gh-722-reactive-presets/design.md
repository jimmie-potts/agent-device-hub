## Context

See proposal.md for motivation and the capability delta for observable requirements. Existing static favorites contain ordinary animation recipes, and decorative show versions contain cue timelines; neither can represent `MusicRecipeV1` unchanged. The show library already demonstrates guarded metadata saves in the module's SDK outbox. This design meets the schema's data-model, migration and ambiguity criteria.

## Goals / Non-Goals

Persist explicit rendering recipes and reload them into the existing preview. Keep live-analysis and calibration settings with core. This adds no generic preset framework, replacement/deletion/history UI, device admission or source selection.

## Decisions

Use two additive tables in Nanoleaf's existing initialization transaction: immutable preset bodies keyed by neutral ID, and the catalog revision. Unlike shows, the full bounded documents fit in a single catalog, so no summary/detail or version read route is needed. The library holds at most 32 documents of 2 KiB each; enforce a 128 KiB bound on its exact UTF-8 serialization including all metadata before commit. Catalog reads validate canonical fully explicit recipes, identities, names and sizes and refuse malformed data without modifying it.

The module-owned profile-2 state `nanoleaf-reactive-presets/2.0` and command `nanoleaf-reactive-preset-save/2.0` use target `reactive-presets`. Save carries `presetId`, `expectedRevision`, `name`, `recipe` and `requestId`. The owner checks catalog CAS, unique ID and deadline, freezes V1 defaults, inserts one row, advances revision, and appends state plus observed outcome in the existing outbox transaction. Rollback proves no effect; expected domain refusals use typed registry errors, full disk uses capacity and other rolled-back storage failures use internal. Publication failure leaves committed data and exact messages awaiting publication. No command is retried. SDK admission, outbox publication and core tracking retain trace continuity and diagnostic ownership under ADR 0012; no payload or private name enters diagnostics. Seed runtime high water from both metadata catalogs and test mixed device/library sync.

Reuse the Wall preview and shell Command lock. Owner sync marks the library stale on resync/failure; late initial completion cannot restore liveness. Scope catalog acquisition to the current connection lifetime: close the prior copy while disconnected, retain the draft and stale values, and acquire a fresh owner snapshot on reconnect before enabling Save. Read-only users may load a frozen recipe locally. Save requires control, connected current catalog, live operations and no unresolved attempt. Failed/uncertain saves keep the draft; only a definitive observed outcome acknowledges the save, and no automatic request ID change or resend occurs. Refresh changes only the catalog. Noneditable effect-local parameters stay visible and preserved.

Accept a second closed preview request `{version:1, recipe, model}` alongside the existing built-in request. Validate through the canonical V1 parser and renderer; browser-safe recipe parsing protects saved state and response equality. The maximal full-recipe request is tested against the gateway's existing 512-character query limit; global SDK bounds stay unchanged. Existing built-in request bytes and rendering retain their interpretation.

## Risks / Trade-offs

- Immutable presets consume capacity permanently. Refuse when full and preserve earlier presets. Replacement, deletion and history are not required by this increment.
- Missing publication can leave a save uncertain. Keep the existing tracked attempt lock and allow outbox reconciliation, never repeat the command.
- Invalid persisted data can prevent library access. Refuse it with fixed invalid-state text and preserve the private database for focused recovery; device families remain independently available.
- Saved names may be personal. Store privately, expose only through authenticated reads and publish synthetic fixtures/evidence under ADR 0011. No source audio, files or media are read or stored.

## Migration Plan

Initialize the additive tables inside the existing owner transaction. Demonstrate the previous source's database schema and earlier favorites/shows before opening with this source, then prove preserved rows, empty library, idempotence and recipe persistence after restart. Failure before schema commit rolls back. Existing source ignores the new tables; preserving the latest database remains mandatory, and this source work performs no installed recovery. Browser acceptance remains required independently of unit tests and CI.
