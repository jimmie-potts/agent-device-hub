## Context

See [proposal.md](proposal.md) and [Hub #376](https://github.com/jimmie-potts/agent-device-hub/issues/376). The nested `@jimmie-potts/roborock-transport` supplies inert construction and six typed reads. Runtime registration, module API 1.3, owner-addressed sync, authenticated content reads, React contributions and read-scoped MCP tools already exist. The SDK opens each module's exclusive SQLite connection with WAL, foreign keys and `synchronous = FULL`.

A design is required because this change introduces persistent household history, private credential handling, timed collection and evidence associations. The pinned MIT adapter at `ce998f6980b9928af800d8083cbe794f3b93ca97` supplies normalization evidence; its declarations and mocks do not qualify current a97 firmware, clock alignment or history completeness.

## Goals / Non-Goals

**Goals:** keep original successful transport values apart from normalized projections; preserve committed history through partial input, restart and publication failure; bound work and public reads; expose uncertainty consistently to the page and MCP.

**Non-Goals:** change the shared SDK/gateway interfaces or transport allowlist, add a second database reader, infer unobserved history, or promote map captures to physical attribution. Installation and real-device comparison remain separate issue gates.

## Decisions

### One configured module and lazy transport

The root package exports a complete `registration` and an explicit browser-only `./frontend`. The unchanged registry discovers it; the nested transport stays a separate dependency. The manifest uses API 1.3, one React page and one read tool. Configuration accepts a routing ID and the module's named private `target`/`session` secrets. It exposes no endpoint, credential or path in public settings.

`start` opens local storage and registers current-state sync, then schedules collection. It neither loads an account nor waits for the device. The real adapter reads its own SDK secrets and constructs the validated transport lazily; routine collection never logs in. Injected synthetic transports use the same collector. Stop cancels timers and calls, retires late work and closes the transport. Missing configuration remains the SDK's named refusal.

This uses the existing runtime ownership boundary rather than another process, port or direct database connection. No compatibility or privacy exception is added to the transport.

### Explicit normalization with missingness

Accept named object forms and the pinned source's explicit positional layouts, including single-record wrappers. Do not guess fields by magnitude, scan for adjacent timestamps, coerce strings to numbers or default missing values. Use shared `unknown`/`known` building blocks for measurements; preserve unfamiliar numeric codes without assigning a meaning.

Keep time in seconds, area in mm², battery in percent and record timestamps as Unix seconds internally, with explicit conversions for display. Preserve `area` and `cleaned_area` separately and do not require duration to equal wall-clock elapsed time. Consumables show measured seconds/cycles; nominal lifetime estimates need separate provenance. Dock bit-field interpretations retain their raw input and source qualification. Robot lifetime totals and retained-record totals are distinct.

The family is `roborock-vacuum/2.0`. Contract fixtures precede its collector/page consumers. Status includes routing identity, persistent revision, evidence times, availability, current observations, totals and collection coverage. The closed generic device record keeps only its existing fields and unsupported control capabilities. Message schemas use the shared blocks; standalone content/MCP schemas embed those same definitions with local references, since the existing tool-schema compiler has no external schema registry. Tests prove both forms reject the same invalid values.

### Serialized collection and bounded reconciliation

One loop owns all reads and persistence. Initial poll policy is 60 seconds docked, 15 seconds cleaning/returning; failed observations use bounded backoff. Calls retain the transport's deadlines and cancellation. Long reads or backfill never create a second loop; record any missed observation interval rather than claiming exact sampling cadence.

Each cycle prioritizes status. Startup and evidenced end observations request a summary and enqueue every valid record identifier. Reconcile that queue in bounded batches, with failed IDs retained for a later attempt. Ancillary consumable/room reads are bounded and independently timestamped. A summary subset or invalid response never replaces the stored inventory. Read, write and normalization failures use fixed registered codes and safe diagnostics; vendor bodies and credentials never enter logs.

Active episodes start only from supported state/flag evidence, not docked counters. Pause, washing, charging and unavailable input preserve an unresolved episode. Matching record identity and end evidence resolve it. Preserve each sample's source observation and episode; attach it only when validated record timing identifies one eligible run. Overlap, incompatible timing or missing evidence leaves samples unattached. Gaps and source clock limitations remain visible.

### Private archive and durable projection

Use `context.database()` only. Retain append-only original parsed JSON observations with operation, request/observation identities, evidence time, collector generation and normalization version. Preserve successful revisions and conflicting record evidence. Canonical runs use `(robotIdentity, requestedRecordStartTime)`. Bind the store to the selected robot identity; a new IP is not a new robot, and a different robot never inherits old history.

Separate tables hold canonical run projections, observed battery samples, gap/episode checkpoints, reconciliation work, deduplicated map BLOBs and capture provenance. No TTL, summary-driven deletion or bounded archive rollup is introduced. Bounded pages are delivery limits, not retention rules. Private content reads expose selected normalized history; original JSON, room mappings and maps remain local.

Perform device reads before an `Outbox.transaction` callback. Commit evidence, projection, revision and public state messages together. Apply cached state only after commit, or restore it after a failed callback. A failed transaction keeps the prior projection; a full disk maps to `capacity`, other unexpected storage failures to `internal`. Retain at most one bounded uncommitted batch for retry and pause new captures while it is blocked. Stable observation IDs permit reconciliation without duplicating a committed batch. Restart loss of uncommitted data becomes a gap.

### Bounded publication recovery

Only the two current state families enter the Outbox. Before admitting another publication batch, call `republish`: success establishes that the prior batch drained. If it refuses, retain new private observations and the latest projection in a transaction without adding more messages. Keep a durable indication that the latest projection still needs publication. This bounds the pending state queue to one batch without reading or changing the SDK's private tables, discarding archive data or repeating collection.

After recovery, drain the prior immutable messages, then enqueue the latest committed projection. Owner-addressed sync and authenticated reads use that projection. No occurrences, notices or device commands are replayed. Tests cover repeated refusal and restart so commitment is never mistaken for publication.

### Candidate run-end maps

Commit the matching run record before requesting its map. At an observed end, collect bounded pre/post status and summary evidence around the current-map read. Store the original decoded bytes and capture provenance together: candidate run, request/response times, collector generation, source observations, map index/sequence and content hash.

The raw header has no run ID. Even unchanged pre/post observations cannot rule out an omitted short run because summary completeness is unqualified. Therefore every capture remains unverified. A restart, gap, delay, newer run or identity conflict invalidates the candidate association while retaining its bytes and reasons. Historical runs discovered at startup get no newly fetched current map. Map failure never rolls back supported run totals. This follows the issue's missing/unverified policy; it does not discard maps or claim #377 coverage.

### Bounded reads and one frontend connection

The manifest's `status` tool returns the same versioned current-status document as the page's content read. Paged run summaries and a selected run's samples use module content references, validated queries, stable cursors and finite result sizes below the envelope limit. Reads neither reach the device nor acknowledge notices. Invalid, unknown, cancelled or unavailable reads return shared refusals.

The browser entry imports only browser-safe types and helpers. It uses `context.api.read` and `sync` on the shell's connection, validates document identity/schema, retires late responses on selection changes/unmount and closes its synced copy. The page shows current status, age, a paged history list and run detail. Battery segments stop at gaps and have a text/table alternative. There are no device controls, map image, widget or history MCP tool.

## Risks / Trade-offs

- Unqualified firmware, clocks and history depth → preserve raw source evidence and qualification limits; source fixtures make no installed claim.
- Record or sample ambiguity → retain originals and leave association unknown rather than inventing a join.
- Map headers lack run identity → retain candidate provenance and unknown coverage; real comparison remains a separate owner gate.
- Full storage cannot record its own failure durably → fixed diagnostics, one bounded pending batch, preserved committed history and explicit gap after recovery.
- Historical archives grow → no silent deletion; bounded reads and visible capacity failure, with private manual backup/recovery.
- Transport secret checks cover known credential material only → no arbitrary-content detection claim; private originals never enter publication fixtures.

## Migration Plan

This adds a new module store and no migration of the owner's probe/session files. Document the runtime configuration seam and private stopped-store/WAL or SQLite-backup recovery procedure; qualify recovery with synthetic storage. Source merge does not enable real collection or change the installed service. Any later authorized installation follows the current runtime's qualified procedure and separately verifies running identity, configuration and health. Keep existing stores during manual return; never replace a failed database with an empty one.

## Open Questions

The separately authorized exact-device check must qualify firmware/account access, source clock alignment, history depth and any defensible run-map attribution rule. None is assumed by source tests, and the source design continues to represent unverified evidence until such qualification exists.
