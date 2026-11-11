## Context

History lives in the core store, `modules/core.sqlite`, in `core_history` with `seq INTEGER PRIMARY KEY AUTOINCREMENT`. `History`'s constructor creates its tables when the store opens, after the lease and the owner check, and the tracker asks it whether an outcome is new, a duplicate or a conflict. The store has no schema version: tables are created if absent, and a part adds a missing column after reading `PRAGMA table_info` (`music-lighting.ts`). The #1729 prototype found that the origin can live in the history row alone, that the duplicate check must look only at the local origin's rows, and that a column with a default collides with raw inserts on the per-origin index.

## Goals / Non-Goals

**Goals:**

- One origin per store, created once, not derived from anything personal.
- `origin` and `origin_seq` on every row, with an exact, repeatable migration in one transaction.
- Read after N inside the core, bounded, with the cursor kept by the reader.
- The duplicate check limited to the local origin.

**Non-Goals:**

- Network exchange, merging, a read route, the staleness check on live intake, new kinds of fact, envelope changes.

## Decisions

1. **The origin is a random UUID kept in `core_origin`.** `crypto.randomUUID()` (version 4) needs no configuration and cannot collide in practice. A one-row table (`only = 1`) keeps it with the history it names, so a backup carries it and a restored copy keeps its origin. A configured label (the prototype's choice) was rejected: it needs a setup step and a uniqueness rule people must keep.
2. **The migration stays in `History`'s constructor, inside one `BEGIN IMMEDIATE` transaction.** It creates the tables (with the new columns for a new store), inserts the origin if absent, adds each missing column with `ALTER TABLE ... ADD COLUMN`, numbers the rows that have no origin, drops the old `core_history_message` index and creates `core_history_origin (origin, origin_seq)` and `core_history_origin_message (origin, source, message_id)`, both unique. Any failure rolls the whole step back; the store's open then fails as `storage-unavailable`, and a full disk is reported as full, as before.
3. **Columns are nullable, without defaults.** A `NOT NULL DEFAULT` column would give every row written by an older release the same default and break the per-origin unique index on its second row, so an older release could no longer write history if it were run on a migrated store. With nullable columns, such rows carry no origin, and the next start of this release gives them this origin and the next sequences, after its last row. History writes always set both.
4. **Numbering uses `ROW_NUMBER() OVER (ORDER BY seq)`** over rows with no origin after this origin's last row, offset by its last sequence. `seq` is the write order; numbering by it rather than copying it keeps the sequence free of gaps if `seq` has any. On a migrated store the step reads one index entry and changes nothing.
5. **A new row's sequence is `MAX(origin_seq) + 1` for its origin, in the same `INSERT`**, which the unique index answers in one lookup. Every write is inside the store's transaction, so two writers cannot take one number.
6. **`after(origin, afterSeq, limit = 500)`** returns `FactRow`, a `HistoryRow` with `origin` and `originSeq`. The existing `read` and its gateway and MCP shape stay unchanged. Arguments out of range throw a `RangeError`; the API is internal.

## Risks / Trade-offs

- **Migration time and disk:** the backfill rewrites every history row once. Measured on a synthetic store of 100,000 rows (about 650-byte records, the runtime's database settings): 376 ms; the files grew from 86.1 MB to 93.9 MB after a checkpoint and peaked at 187.3 MB (the write-ahead log holds the rewritten pages until the checkpoint). A store needs free space about the size of its history before the first start of this release.
- **Recovery to an older release:** the older release ignores the new columns, recreates its `(source, message_id)` index, which holds while every row is local, and writes rows with no origin. This release numbers them at its next start. This is reasoned from the code and the second migration test, not an installed recovery qualification.
- **Rows without an origin:** the schema allows them; only the older-release case writes them, and the next start fills them.

## Migration Plan

Forward-only, at the core store's first open by this release, in one transaction. A failed migration leaves the store exactly as it was and the core unavailable until the cause (for example a full disk) is fixed. Operators need do nothing beyond the routine upgrade procedure and enough free space. Installation is tracked separately.

## Open Questions

None for this story. Whether a read route for other installations counts as a new message format is the two-machine work's question under ADR 0012's amendment (#1739).
