## Context

`NumericStore.ingest` appends a gap from the previous `lastSuccessAt` to the new observation time when the interval exceeds 300,000 ms or the prior attempt failed. A gap that continues the previous same-reason gap extends it. The installed Windows task starts every five minutes, and a run publishes 3-8 seconds after it starts, so successive success times differ by roughly 300 s plus or minus run-time jitter.

## Goals / Non-Goals

**Goals:** record gaps only when an observation was actually missed; keep a single missed run visible.

**Non-Goals:** making the tolerance configurable, rewriting retained gap history, retaining per-attempt failure history, or changing freshness/`lastSuccessAt` semantics.

## Decisions

- **Tolerance of 450,000 ms (1.5 times the cadence).** On-time spacing is 300 s plus run-time jitter, bounded in practice by the 60 s command budget (at most 360 s). One missed run produces about 600 s. The midpoint gives margin on both sides. Alternatives: a fixed small grace such as 310 s fails when a run approaches its 60 s budget; two times the cadence (600 s) would hide a single missed run.
- **Constant, not configuration.** The cadence is fixed by #472's installation contract. A config field would add validation and migration surface without a current need.
- **Inclusive boundary.** An interval of exactly 450,000 ms counts as observed, matching the existing strict `>` comparison.

## Risks / Trade-offs

- A single run that is delayed but not missed, landing between 450 s and 600 s, records a short gap. That reflects real lateness and remains visible.
- Gaps recorded before installation stay as published; the owner may use the existing reset with historical reimport.
