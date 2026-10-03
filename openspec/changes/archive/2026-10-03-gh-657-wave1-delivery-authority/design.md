## Context

The existing preflight evaluates human UI approval by path and comment. Runtime-install instructions require a fresh owner checkpoint even when standing authority exists. These policies now conflict with the owner's settled decisions. Existing issue assessment remains the home for refreshed alignment.

## Goals / Non-Goals

Align the active procedures with those decisions while preserving verification and effect boundaries. Do not change installer code, receipt schemas, device ownership, review count, publication authority or qualify unattended execution.

## Decisions

- Preserve the preflight schema-1 `ui-approval` entry as not applicable. Accept and ignore legacy UI flags, without fetching their values. This avoids needless caller breakage while removing the obsolete gate and path exemptions.
- Keep `source` as the diagnostic preflight default; its result explicitly does not certify installed completion. Live acceptance continues to require separate evidence.
- Keep authorization and exact-plan approval distinct: the coordinator verifies scope and uses the existing digest under standing authority. Changed inputs require replanning and a scope check; new effects outside authority still stop. Owner-defined authority is not created by generic contract prose.
- Keep current direction in accepted architecture/ADRs and changing scope/status in GitHub. Pickup discovers newly relevant evidence without creating a separate dossier or rewriting accepted scope.
- Synchronize the existing normative requirements, retaining their scenarios. No new product capability or schema is introduced.

## Risks / Trade-offs

Ignoring old UI flags can surprise a caller relying on that gate; CLI help and documentation label them deprecated and explain the retained validation. Broadly interpreting installation authority could change unrelated systems; root instructions, the contract and local procedure name the established target and preserve device, first-adoption, hosting and compatibility boundaries. Dated snapshots retain historical wording with a current-policy pointer.

## Migration / Recovery

No runtime migration occurs. Delivery updates the repository instructions and coordinated installed skill revision, with content readback. The Hub installer retains its pre-switch refusals, bounded post-switch rollback, state preservation and interrupted/finalization inspection requirements unchanged. This instruction/tooling change does not require restarting the Hub.
