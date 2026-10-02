## Context

See proposal.md for motivation and #469 for acceptance. The existing collector owns the Windows read transaction, bounded worker, private SQLite contributions, control epochs, atomic JSON publication and managed backups. Its language table is reserved but empty. The aggregate contract already defines independent corpus tables, coverage, support counts and unknown finality. The reviewed Hub accepts `english-1` / `english-stop-1`. Security, bounded work and retained-state transitions require this design artifact.

## Goals / Non-Goals

Goals: add language analysis within the existing owner, reuse the numeric contribution identity, and preserve exact subgroup support and private recovery guarantees.

Non-goals: infer why an edit happened, claim sent text or accuracy, discover or inspect a personal source, copy transcripts into storage, add an external model or service, or enable installed collection. Optional dictionary text labels are not required for snapshot counts and will remain absent without qualified support.

## Decisions

- Extend the existing source scan with an explicit language option. Numeric callers keep the same text-free allowlist. Enabled scans may select the three named stage columns and a fixed, documented metadata profile only when schema types qualify. Bound individual stage materialization before reading it, then enforce the 2000-token limit. Missing/unknown language or observation metadata produces coverage exclusions, not guessed English or confident edits. Controlled fixtures qualify the adapter and algorithm; installed field semantics remain an explicit acceptance limit.
- Keep normalization, sensitivity filtering, tokenization and alignment in one pure language module. Use versioned English normalization and apostrophe handling, a fixed stopword set, contiguous within-record n-grams and deterministic ordinal tie-breaking. A bounded dynamic-programming alignment has an explicit work budget; over-budget comparisons are excluded with coverage. Do not add a tokenizer/model service or concatenate records.
- Conservatively exclude the whole stage on a detected sensitive pattern; owner term exclusions leave null boundaries before deriving words, phrases or displayed change endpoints. Comparisons crossing such boundaries are uncertain, so removal cannot invent adjacent phrases or changes. Retain only unordered counts, stage availability and bounded change features in the private store. A source record's ID/time stays in the existing private contribution relation; none enters public tables. Include an algorithm/policy identity in derivatives so archived incompatible features become visibly unavailable rather than silently recomputed.
- Aggregate exact preset/app/category/corpus groups from the eligible private contributions. Apply three-distinct-dictation support inside each group, then sort and cap each kind at 100, recording omitted qualified candidates. Daily top-N merging is unsuitable because it loses globally frequent terms. Keep all/current-app/category intersections supported within the existing 1000-table and 16 MiB contract caps. Capacity failures preserve the prior committed report and remain visible.
- Replace a record's complete language contribution on every successful changed observation. Keep absent records' derivatives with archived numeric contributions. A failed scan changes neither set. Reporting-zone rebuild uses retained private times to regroup compatible features without reading source text. Algorithm changes cannot reconstruct unavailable archived text; retain its private contribution and report excluded coverage.
- Apply config opt-out before any pending publication or source read, including status/export and collection-disabled operations. Advance the existing text epoch/generation, remove language rows and text-bearing managed backups, and publish the disabled generation while retaining numeric history. Reenable only during an explicit eligible collect using still-available source text. Restore remains numeric-only and never copies old language rows or publication tables. This reuses the independent control authority instead of introducing a second clear mechanism.
- Read optional dictionary/snippet numeric metadata in the same bounded source observation using an explicit supported profile. Preserve unavailable fields and unknown counter windows. Store the latest snapshot and comparison segment; repeated values are not summed, and qualified decreases/reset start a new segment. No dictionary entry text is needed to count entries or usage.

## Risks / Trade-offs

- Private derivatives can reveal wording even without transcript fields → owner-restricted storage, no logging/telemetry, subgroup suppression, sensitivity filters and documented limits; never call the result anonymous.
- Source metadata may be absent or ambiguous → independent unavailable/uncertain coverage; no field-name-only assertion of finality or sent text. Synthetic success does not qualify the installed source version.
- Large vocabularies and alignment matrices consume resources → fixed per-stage/work limits plus the existing process, store and aggregate caps; no silent truncation into plausible changes and no history eviction.
- A pending text revision could cross opt-out → reconcile the privacy transition before retrying publication and test interruption, restart, restore and managed backups.

## Migration Plan

Accept existing `{enabled:false}` configs unchanged. Add strict optional owner exclusions to enabled language configuration. Existing numeric stores can initialize the reserved language table without changing numeric contribution identity; unsupported derivative versions fail closed or report unavailable. Update the source package version and lockfile together, without changing the wire envelope unless an observed acceptance need requires coordinated consumer changes. Keep rollback numeric-only and require text clear before running an older collector against text-bearing state. No installation or settings changes occur in this source delivery.

## Qualified synthetic profile

The README records the exact bounded text/metadata and dictionary field profiles.
`editedTextStatus=complete` plus a valid `editObservationEnd` qualifies only the
controlled observation adapter, not installed Wispr semantics or sent finality.
Unknown profiles are excluded. Dictionary flags/counters have independent null
availability and unknown windows. Public schema references support the known
text/language names but do not establish this Windows installation's metadata.
No private source was read to fill that gap.

Privacy tests exposed a cleanup ordering risk: a malformed managed backup can
throw after the text-clear authority is durable. Publish the text-disabled status
before reconciliation/backup cleanup; this fences the old Hub cache even when
aggregate replacement or cleanup fails. Apply the same revision fence before
replacing pending rankings after an exclusion-policy change. Opt-out precedes
reporting-zone mismatch and collection-disabled errors.
