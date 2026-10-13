## Context

See proposal.md for the owning #376 correction. The collector retains cleaning and returning through one private episode; matching and the store require its association window to fit the completed cleaning record. Returning can continue after that record ends. Timing behavior warrants this design artifact under the configured schema.

## Goals / Non-Goals

**Goals:** associate the observed cleaning window without discarding returning originals, while preserving the sole store owner, existing evidence rules and unverified map attribution.

**Non-Goals:** clock-offset inference, looser matching predicates, archive rewrites, retrospective maps, new exports, vacuum controls or a general phase framework.

## Decisions

Advance the episode's association boundary on cleaning or an observed pause, while returning remains active for polling and original sample retention. A returning-only observation can still open an unresolved episode; it cannot invent earlier cleaning evidence. Keep terminal evidence and completed-record matching unchanged. This preserves the store format and previous reader behavior.

Keep all original returning observations and battery samples. Existing eligibility limits expose only the compatible cleaning interval. Do not revise old episode boundaries or fabricate a capture missed by the installed prior implementation.

A broad clock tolerance or relaxed record/store matching would admit unrelated or ambiguous windows. A new storage model is unnecessary for this bounded correction; use the existing collector and schema instead.

## Risks / Trade-offs

- Returning starts after the cleaning record ends → retain originals but do not extend the association boundary or infer a clock offset.
- An ambiguous or returning-only episode → retain the existing refusal and historical-map exclusion; add a negative regression.
- Existing missed captures remain missing → preserve their actual evidence and verify a future owner-started run after installation.
- A later conflicting record invalidates eligibility → retain the store's conflict checks and original links.

## Migration Plan

No archive, configuration, transport or wire migration is required. Deliver through the existing PR/review/CI process. Update the established runtime only through its qualified procedure using fresh current identity and locks, then verify retained state and fresh collection. Physical acceptance remains pending until an owner-started run and app/map comparison prove it. Source success grants no vacuum control authority.
