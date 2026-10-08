## Context

The runtime cutover needs a plan before it can stop writers, back up stores or
run the existing converters. The Hub planner currently gathers installed facts
itself and binds them to its single-service, latest-durable-state contract.
That adapter and install-receipt/1.0 must keep working. The cutover receipt
decision is pending, so this slice establishes a pure preparation boundary.

The planner consumes explicit facts. It does not establish that the supplied
inventory matches the installed host. Later discovery and execution must qualify
paths, mounts, ownership, source revision, stopped writers and current sizes.

## Goals / Non-Goals

**Goals:** deterministic, digest-bound preparation; complete coverage of the
declared writers and physical backup sources; ordered converter inputs; named
missing adapters; per-filesystem space refusal before any effect.

**Non-Goals:** a runnable installer, discovery, command generation, store reads,
backup or migration execution, service or hook changes, receipt creation,
activation, physical acceptance, or completion of the full installer story.

## Decisions

### Keep preparation separate from discovery and effects

Add `apps/runtime/src/install/planner.ts` with typed facts and a synchronous pure
planner. Its only non-type dependency is Node's SHA-256 implementation and path
normalization. There is no callback for effects and no operator entry point.
The existing runtime TypeScript project includes the new source and test file;
no package, dependency or build-script change is needed.

The result always says execution is unavailable. A valid preparation can still
be blocked by insufficient space or a missing converter/verifier. Invalid
facts produce an internal typed input error; these reasons are not new profile
2.0 wire codes. Later code must map errors through its owning protocol.

### Distinguish physical backups from logical conversions

Facts include the owner, exact source revision/tree, explicit backup and runtime
destination roots with volume IDs, volume free-space/reserve observations, the
new release's estimated size, writer inventory, physical store inventory and
logical migration selections.

Each store names its absolute source path, kind, observed total bytes, inventory
digest, writer IDs and whether it is a migration input or backup-only. A SQLite
source's size and digest cover its complete selected snapshot, including its
WAL where present. The eventual backup operation must use SQLite backup or copy
the stopped database with its WAL; the planner cannot verify a snapshot.

Every declared writer is in the stop/fence step. Every store is backed up and
verified once, including backup-only stores. Unknown writer references, duplicate
IDs, overlapping physical store roots and uncovered migration-input stores are
invalid. Multiple converters can read one physical source without duplicating
the backup. Backup-only sources cannot be converted.

Migration groups follow the accepted converter order: Nanoleaf, Pixoo library,
Pixoo configuration, LIFX, Tidbyt, playback, Hub edge, Codex Desktop, automation,
then Wispr configuration. Every group has an explicit selection: convert using
named input stores and adapter/verifier identities, or not configured with an
explicit reason and no inputs/output allocation. An absent group is a missing
input, not an implicit fresh start. The converter owns record-level selections;
this planner neither reimplements it nor copies excluded sessions/history into
the runtime. Wispr collector data and CHOMPI state are not migration groups.

The steps are stop/fence, backup all sources, verify all backups, selected
conversions in order, verify all converted results, then await the separately
qualified execution boundary. No step is a shell command. A missing adapter
blocks preparation; the planner never substitutes a successful conversion.

### Bind every meaningful fact and calculate space per volume

Normalize a fixed structure with explicitly ordered fields. Sort set-like IDs,
writer references and physical inventory; retain the defined migration order.
Hash this normalized structure directly rather than introducing a second generic
canonical-JSON utility. Recompute the plan from current facts when checking a
supplied digest. Digest equality establishes unchanged preparation inputs only.

All byte counts are nonnegative safe integers. Add with overflow checks. Charge
each physical source once to the backup volume; charge each conversion estimate
and the release estimate to the runtime volume. If both roots share a volume,
combine those allocations. Add that volume's explicit reserve once and compare
against its available bytes. Spare space on one volume cannot cover a shortage
on another. Volume identity is a caller observation, not inferred from paths.

Require canonical absolute Linux paths and lexical separation between source,
backup and runtime locations. Reject root, dot segments and duplicate/nested
destinations. This does not detect symlink aliases or verify mount identity;
later installed qualification must do both before effects.

### Preserve the legacy installer boundary

Do not import the filesystem-owning Hub planner across TypeScript rootDir
boundaries, move its file helpers, create a workspace, or put installation types
in the device SDK. The small pure model needs no such coupling. Leave legacy
plan/digest behavior and install-receipt/1.0 unchanged. The cutover's accepted
manual recovery semantics do not silently change that receipt contract.

## Risks / Trade-offs

- Caller facts can be incomplete or stale despite internally valid coverage.
  The result is preparation-only and makes no installed-host readiness claim.
- Output estimates can be wrong. Bind their values and explicit reserve now;
  the executor must refresh qualification and handle later capacity failures.
- Lexical path checks cannot establish filesystem ownership or alias safety.
  Do not expose this model as an executable CLI before those checks exist.
- This slice deliberately has no caller yet. It establishes a tested seam for
  the later installer adapter without inventing its receipt or service contract.

## Validation

Use synthetic facts and one exact pure test file. Demonstrate red/green for
writer/store coverage, physical-source deduplication across logical migrations,
ordering, adapter gaps, independent/shared-volume accounting, insufficient space,
overflow, stable digests, meaningful input drift and unchanged caller inputs.
Check the existing Hub digest contract without invoking installed planning.
Run build, typecheck, lint, required shared checks and OpenSpec validation.
Independent Standards and Specification review the frozen candidate; the final
review records why an internal pure model has no running-application Acceptance
surface. Full installer Acceptance and migration/recovery/security reviews remain
required for the later executable delivery.
