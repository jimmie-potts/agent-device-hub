## Context

The collector's fixed SQL projection is in `reader-engine.ts`; normalization, numeric eligibility and language qualification already operate on internal field names. Installed metadata confirms the native primary key and timestamp declaration. Private aggregate-only probes confirm stable identifiers and compatibility with the existing explicit-offset timestamp parser. Design is required because this extends a source schema boundary.

## Goals / Non-Goals

**Goals:** Accept the qualified native History profile, retain the prior profile and keep all source reads bounded and read-only.

**Non-Goals:** No configurable field mapper, inferred timezone or duration units, source writes, text capture without opt-in, new edit-finality assumptions or shared aggregate change.

## Decisions

- Choose the existing profile when `id` exists. Otherwise accept only the fixed native `transcriptEntityId` text primary key with its non-null declaration. Invalid existing `id` does not fall back to another field. Runtime identifier and duplicate checks still apply.
- Map native `transcriptEntityId` to `id` and native `app` to `appName` in the fixed SQL projection, including selected-byte accounting. Preserve normal optional-field coverage and sanitizer behavior. Do not select context, URLs, screenshots or audio.
- Permit DATETIME only in the native profile, alongside existing textual declarations. Preserve runtime string validation and zoned parsing; absent offsets remain excluded rather than guessed.
- Keep numeric and language eligibility independent. A missing `editObservationEnd` continues to produce unknown observed-edit coverage; the native profile does not reinterpret other source metadata.
- Build and review a new package. Do not patch the installed artifact. Config/state remain compatible; the paused empty installation preserves its namespace and explicit owner choices.

## Risks / Trade-offs

The profile is a qualified fixed mapping, not a promise to support every Wispr version. Unsupported required shapes fail closed. Declared DATETIME does not establish the meaning of numeric values; only valid timestamp strings enter metrics. App and duration semantics, installed private samples and one-day behavior need installed evidence after source qualification. Package rollback preserves private state and may restore the earlier source-schema failure. Source ACLs and the accepted permission relaxation remain unchanged.
