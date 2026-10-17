## Context

See proposal.md and #1133. The manual operation already verifies release inventory, installed executable closure, ownership, private inputs, lock, backup and receipts. The additional fixed owner/phase certificate has become a routine gate even for inactive code.

## Goals / Non-Goals

Keep the established installation and manual effect sequence. No automatic recovery, new storage migration engine, product API or device authority.

## Decisions

Use closed request/plan 2.0 records. Previous and target releases are required. Recovery is null (unknown) or pins the exact original previous artifact and its private latest-state evidence; no default recovery release. A direct baseline-closure pin replaces the certificate's baseline indirection. A private change-assessment pin records affected stored formats and focused forward evidence. The coordinator reviews meaning; hashes establish unchanged bytes only. Broad source fingerprints and fixed owner/phase matrices are historical diagnostics, not routine compatibility verdicts.

Reuse existing source integrity, baseline, paths, execution, health and receipt readers. Forward checks inventory known retained owners without opening their live databases. Inactive BB-8 data remains opaque and its Windows helper is untouched. Configured modules still require ordinary running health; the always-started companions owner remains release-specific. Recovery checks refuse before observations when no recovery was qualified. A qualified recovery needs latest-state evidence for affected formats and current selected owners; this is an operator decision, not inferred from inventory equality.

Keep receipt schema 1.0. Qualified same-operation recovery must match the original previous artifact and complete verified identity; a different release needs a separately assessed operation. Record unknown rollback honestly; do not select it or invent successful compatibility. Preserve the old receipt resolution path for historical operations while allowing plans 2.0 for new operations. Unknown recovery does not permit snapshot restoration. Prefer a separately assessed fix forward. Snapshot restoration requires explicit owner choice, preservation of failed latest state and a stated data gap.

## Risks / Trade-offs

- Less advance downgrade proof can leave a failed candidate without a usable older reader. Keep the stopped-writer backup and verified releases; stop for inspection, preserve state and prefer fixing forward.
- An evidence pin cannot establish semantic compatibility. Require review of actual changed storage paths and targeted write/reopen evidence when formats change.
- Stale approval confusion is prevented by new closed schemas and fresh plans; immutable historical receipts remain interpretable.

## Migration Plan

Deliver helpers and instructions together through reviewed PR/CI. Generate a new private request and read-only plan for the established installation; preserve old requests/receipts as historical evidence. #483 owns the eventual routine upgrade and independent activation/physical checks. No service restart is needed to qualify these operator tools.
