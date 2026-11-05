## Context

See proposal.md for motivation. The Nanoleaf module already owns the bounded immutable timeline compiler, one private SQLite connection, an SDK outbox, authenticated module content reads and a React frontend. The compiler imports server-only rendering dependencies. Favorite edits also change device configuration; they are not a library-save path. Significant persistent data and new module-owned messages require this design under the schema's data-model and security criteria.

## Goals / Non-Goals

Keep authored versions immutable, saves explicit and guarded, reads bounded, and metadata outcomes distinct from device outcomes. Preserve one module owner and all existing device state. This slice adds no playback, scheduling, media access, recording identity, analysis, calibration or exact-frame renderer.

## Decisions

- Store show heads and append-only versions in additive tables in the module database. A save carries showId, expectedVersion (zero for creation), name, versionName and timeline; it creates exactly expectedVersion+1. Reusing the mutable favorite table would break version identity and device independence.
- Bound the library at 32 shows and 256 total versions, with each exact stored JSON document at most 128 KiB in UTF-8, including its identity and names. These caps permit several experiments per show for one operator while bounding plan data to 32 MiB before SQLite overhead. Refuse at capacity; never erase earlier versions to make room.
- Use the fixed `shows` subject for the module-owned `nanoleaf-show-save` profile-2.0 tracked command and `nanoleaf-shows` catalog state. The catalog contains names and version summaries, not every cue. Save version/head, catalog and matching observed metadata outcome in one synchronous outbox transaction. Use the module's owner-wide high-water revision for sync, separate from the per-show version guard. Existing core request tracking prevents command resends. Recovery republishes committed state/outcomes without rerunning a save.
- Read one immutable version through `/modules/nanoleaf/content/show-version?showId=...&version=...`, checking the exact closed query and abort signal. Authoritative server preparation freezes explicit recipes. Corrupt saved versions are unavailable without rewriting or deleting them.
- Keep reusable browser data/types and deterministic starter definitions inside Nanoleaf. The browser uses these records to draw a semantic cue storyboard; it imports no compiler, storage or device transport. Preview never runs a clock or sends commands. Gaps and show end are labelled, with no inferred blackout or return behavior.
- Track catalog sync completion independently of the initial promise so a delayed response cannot undo restart invalidation. A version read has a local Cancel action that unlocks and retains the draft, fences the late response, and permits no second content read until the first settles. Successful reads pin their exact show/version selection.
- Register a `shows` module page and add an Audio link only while that page is in the current module catalog. Drafts stay in memory. Saves use the shell's retained command attempt, live state and control guards; old expected versions remain old after another client saves. The operator explicitly opens the new version. An uncertain command remains locked until existing tracked reconciliation resolves it, with no automatic resend. Refreshing the catalog does not clear that lock.
- No diagnostics include authored names or cues. Fixtures and publication evidence are synthetic. Existing authenticated private storage/read boundaries apply under ADR 0011. Future Music Understanding integration needs independent silence/quality rejection: synthetic silence can produce a nonempty beat grid, so beat availability alone is not evidence of rhythm. It is not a dependency of this editor.

## Risks / Trade-offs

- Metadata accidentally wakes a writer → separate admission/outcome path, compare device state and transport activity before and after saves and reads.
- Catalog revisions fall below the SDK snapshot floor → use the existing owner-wide high-water revision and restore persisted catalog revision on startup.
- Storage commit fails after validation → transaction rollback preserves heads, versions, catalog and outcomes; full storage is a fixed capacity refusal.
- Concurrent edit overwrites another save → explicit per-show version guard, conflict and retained draft.
- Browser preview is mistaken for output evidence → label it a decorative cue storyboard, with no play control, rendered geometry or synchronization claim.
- Existing favorite privacy changes accidentally → keep the favorite state family out of this page and expose only the new show catalog.

## Migration Plan

Initialize new tables idempotently in the existing schema transaction. Existing favorites, settings, control journals and device revisions are unchanged. Disposable tests upgrade an existing store and reopen versions after restart. Old source can ignore these additive tables; no downgrade deletion or snapshot restoration is introduced. Installation remains a separately owned operation.
