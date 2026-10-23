## Context

See proposal.md for the installed failure. History owns synchronous SQLite reads; HTTP and core_history share its closed filter schema. Timeline already has cancellation, fixed refusal labels, manual refresh and local category/presentation state. The cross-surface read contract and resource consequence warrant this design artifact.

## Goals / Non-Goals

Bound Timeline result materialization while preserving existing callers and the complete private archive. This is a row window, not pagination, a byte cap, filtered-scan timing guarantee or archive retention policy.

## Decisions

- Add optional limit 1..500 in HistoryFilter and its shared validation/schema. Parse its HTTP decimal representation as a number like time filters; MCP retains integer validation. A new endpoint or global default would change unnecessary compatibility surfaces.
- Combine all existing filters before SQLite ORDER BY seq DESC LIMIT ?. Reverse just the selected rows before JSON parsing for oldest-first compatibility. Client slicing would still load the whole archive. Latest means committed sequence, not an externally supplied timestamp.
- Timeline sends limit=200 on all queries. Show “Latest N · Read …” for a successful snapshot, with an accessible description identifying categories as filtering those loaded entries. Empty states refer to loaded entries. Show more reveals the existing local window only. No automatic retry or polling.
- Existing gateway read scope, invalid-request errors, SDK child trace and no-command path remain. No new diagnostics or raw outward error details. Private source evidence stays private under ADRs 0011/0012 and the diagnostic contract.

## Risks / Trade-offs

- Row count does not bound record bytes or filtered scan time → test a materially larger synthetic archive and large records; bounded installed readback must prove the selected use practical. Do not claim a global history resource guarantee.
- Categories can omit older archive matches → identify the loaded window and use window-specific empty labels.
- Omitted-limit callers retain expensive reads → keep compatibility explicit; never repeat unlimited installed probes.

## Migration Plan

No storage migration. Deliver one additive runtime/dashboard release through existing PR/review/CI and qualified WSL upgrade. Retain the stopped-writer backup and previous release; use the owning recovery procedure if needed. Verify bounded Recent, all history request caps, unchanged service identity/health and passive state. No owner layout save or physical command is needed.
