## Context

The current runtime already has reviewed admission helpers, a release anchor and disposable production-store upgrade/recovery tests. The established installation has completed first adoption. See `proposal.md` for the owner-selected change to initial installed qualification.

This design is included because the qualification requirement affects recovery authority and installed acceptance. It changes procedure text and the acceptance spec without changing runtime behavior or admission inputs.

## Goals / Non-Goals

**Goals:** Make the initial installed window finite, preserve the evidence needed to assess its result, and disclose the recovery paths that have not been exercised live.

**Non-Goals:** Alter helpers or compatibility checks, repeat first adoption, authorize a service operation through this source change, or reduce dependent ONN features.

## Decisions

1. Update the opening qualification boundary, add a short checklist linking the existing detailed steps, and replace the final live three-selection instruction. Keep all command blocks unchanged so established plan, locking, backup, receipt and recovery mechanics remain authoritative.
2. Retain synthetic upgrade/recovery/re-upgrade and pre-effect refusal evidence. The alternative deliberate live return/re-upgrade adds restarts and is no longer the owner's selected initial gate. Report that reduced assurance explicitly.
3. If a real failure occurs, inspect the durable intent and actual selection before the one recovery allowed by the approved plan, then end the window. A recovered baseline does not establish a successful forward upgrade.
4. Keep source, procedure, operator and installed revision identities distinct. Previously pinned procedure bytes remain historical evidence; before any installed action, review the changed qualification boundary, refresh the exact plan and retain applicable current approval. Do not silently treat an old three-selection proposal as authority.

## Risks / Trade-offs

- Live recovery and re-upgrade are untested → retain disposable production-store evidence, verified previous bytes and a compatible latest-state recovery path; disclose the gap in installed acceptance.
- Earlier tracker text still requests a deliberate live rehearsal → preserve the original coordination comment and reconcile the current criterion and dependencies before closeout.
- A source merge could be mistaken for installed qualification → keep the installed criterion pending until the actual single forward operation and final readback succeed.

## Migration Plan

Deliver the Markdown/spec amendment through independent review and normal protected merge. No runtime installation or restart follows from this documentation-only change. The separately authorized initial forward upgrade uses the amended checklist and existing qualified helper mechanics. Any return remains subject to its exact approved recovery plan.
