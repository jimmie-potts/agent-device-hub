## Context

See proposal.md for the authorized #889 cleanup. Accepted cutover #840 replaces the old running writers but retains their code and stores for manual return. The current dashboard requirement incorrectly says the old Hub keeps serving until retirement.

## Goals / Non-Goals

Make current entry points and evidence boundaries agree with accepted source and installation records. Preserve 1.x compatibility, original ADR rationale and pinned September diagrams. No implementation, installer, device command, Guide refresh or public publication changes.

## Decisions

- Keep README as the documentation-ownership map and architecture.md as the current architecture entry point. Replace stale status with links to its owner; do not build a second status ledger.
- Amend only the dashboard requirement's legacy-retention clause, retaining all dashboard scenarios. This aligns the already accepted fresh-start decision; it does not change application behavior.
- Add standalone Archify JSON/HTML outside Guide ownership. Reusing its diagram generator would add a new retirement dependency; extracting all existing consumers remains #890.
- Mark the runtime upgrade qualification gap explicitly. A speculative manual upgrade recipe or the legacy installer would claim assurance and authority this documentation task cannot establish.

## Risks / Trade-offs

- Historical detail remains lengthy: label legacy sections, preserve their anchors and leave consolidation to #891.
- Render success cannot prove code alignment: pin source, cite owners and obtain independent semantic review separately from artifact/browser checks.
- Installation evidence is dated: link #840's bounded accepted record and exceptions; do not claim a new live check.

## Migration Plan

Merge the reviewed documentation. No runtime installation, service restart or data migration applies. The old-source retention and manual-return boundaries remain unchanged.
