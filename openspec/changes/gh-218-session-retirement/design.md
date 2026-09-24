## Context

See proposal.md. The owner already serializes ingestion and commits full session replacements for expiry. Snapshot and storage 1.0 are closed, and neither exposes a stable record generation. Nanoleaf retains local task/effect rows keyed by the native selector, while Pixoo and Tidbyt render current snapshots. Design is required because this change affects persistence, ordering and consumer compatibility.

## Goals / Non-Goals

Retirement, safeguards and a fresh generation form one owner transition. Keep native identities and existing queues. Do not add a cleanup service, infer an end from elapsed turn time, or use archive state to remove existing records.

## Decisions

1. Reuse atomic replacement. Collect descendants only by exact known parent identity, with a visited set for cycles. Remove all selected records and save their retirement guards before publishing one revision. Unknown ends do not create records.
2. Store minimal retirement evidence in durable format 2.0: identity, retirement time, known turns, retry keys and comparable ordering watermarks. Retain at most 128 identities for 24 hours, merging repeated incarnations' bounded evidence. Keep this separate from active capacity and journal pruning. Reject recognizable retired turns/retries/sequences before any new mutation, including an old end after resume. Retired identities require session.started or turn.started; an absent retired parent blocks new children naming it.
3. Assign each newly admitted record the next owner revision as its generation. Imported legacy records use zero. Generation survives restart/export and changes on recreation. The selector stays native. Observation times cannot substitute because they change during a record's life. Owner reset outside the supervised migration contract has no continuity guarantee.
4. Keep snapshot() and existing HTTP reads at 1.0 by default, stripping internal generation. Explicit 1.1 reads expose optional generation metadata. This keeps existing readers usable while Nanoleaf adopts generation-aware reset in a scoped companion. Pixoo/Tidbyt need focused current-snapshot checks rather than new per-task caches. Dashboard checks establish whether any row-local state needs reset.
5. The host supplies bounded archive evidence at new-record admission through the existing Codex-home configuration. Inspect only matching archive filenames, never file contents. Missing evidence fails open. A 200 ms deadline and finite directory-entry count bound the lookup; retirement never invokes it. No background archive polling or retained stale archive result.

## Risks / Trade-offs

- Missing turn/order/retry evidence can make an unseen delayed start or end indistinguishable from new work. Preserve unknown ordering and document this limit; never invent timestamps as causal order.
- Retirement memory evicts at its count/age bound. Rejection outside retained evidence is unsupported; the separate old-observation cutoff still applies.
- Legacy readers cannot detect recreation hidden entirely between reads. The upgraded Nanoleaf reader must request 1.1 before claiming fresh local task/effect semantics.
- A failed atomic commit publishes no removal; the owner faults and restart loads the committed state. No partial descendant removal is visible.
- Default archive lookup unavailability must not strand monitoring. Positive evidence is only a safeguard, not an authority to clean Codex files.

## Migration Plan

Expand source support for both snapshot versions and legacy durable imports, then validate the Nanoleaf companion against the new source artifact. New stores use format 2.0; opening 1.0 performs a guarded replacement preserving evidence clocks and state while adding generations. No installed store is opened by source tests. Older owners cannot read format 2.0. A separately authorized installation backs up the old store and qualifies consumers; rollback after new writes requires a compatible owner or an explicitly reconciled export, never silently restoring an older database. Keep immutable previous artifacts.

Installation/client/visible-device checks remain pending under the exact issue. The source proposal does not authorize them. Timing evidence must distinguish accepted owner retirement from display polling and transport cadence.
