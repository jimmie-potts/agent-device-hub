## Context

See proposal.md for motivation. The core already marks newly committed occurrences in AutomationPart and consumes the marks on first publication. It owns session and mode state; modules use SDK sync and private SQLite. The React shell collects explicit module frontends statically. This design is required by the schema's cross-cutting/data-model criteria.

## Goals / Non-Goals

Goals: one integrated fixed-text path with authoritative source attribution, no replay, bounded admission and final asynchronous validity checks. Non-goals: provider frameworks, speech, next prompts, sensors, alternate state owners and installation.

## Decisions

- Extract the existing bounded publication eligibility into a core-local helper. Automation and the companion producer each consume their own marks from the same committed change. The producer publishes only a minimal profile-2.0 occurrence over the SDK; no durable opportunity queue or SDK runtime extension is needed. Recovered outbox publication cannot mint eligibility.
- Keep candidate arbitration, rules and seeded fixed-text selection module-local. An actual scheduler handoff supplies asynchronous waiting; final checks use the current synced core copy, never an imported core store. A bounded presentation publication boundary checks validity again before publishing. Refusals are decisions, not device errors.
- Persist settings and bounded reaction/admission records in the module database. Startup syncs current session/mode membership and restores prior presentation as history. Fresh Free mode does not recreate opportunities. A lost sync refuses unsolicited presentation until a bounded backoff sync succeeds.
- Use existing tracked commands for settings and labelled arrival/visit scenarios. Synthetic mixed scenarios carry their own coding/arrival facts and allowance context; none becomes a live session or household fact. An admission reserves the appropriate context allowance and does not refund ambiguous output into another slot.
- Publish only the occurrence and presentation/settings families actual consumers use. Rule, reason and selection implementation stays internal. All outward errors use the existing registry/static details; diagnostics use existing decision records and original trace context.

## Risks / Trade-offs

- Consumer lag -> recheck synced revision/generation, freshness and identity at the actual final publication boundary; loss of sync cancels candidates.
- Output failure after durable save -> retain historical evidence and report awaiting/unavailable publication honestly; never claim visibility or repeat a reaction.
- Synthetic data confusion -> fixed labelled scenario context, unknown identity/location, separate allowance/repetition/history, no physical/audio endpoint.
- Module additions affect static inventory -> update existing build, contract, runtime, browser and catalog coverage before review.

## Migration Plan

Source only. Add the optional disabled module and additive profile-2.0 families. Existing session/automation behavior remains covered by regression checks. Deployment/installation is owned by #643; this change starts no installed runtime.
