## Context

See proposal.md. The owner already retires Codex Desktop records atomically with durable guards and generations (#218). The rule was gated by provider/client in three places: guard checks, the retirement branch and the durable-export validator. Design is required because the change alters durable state on upgrade and the ordering/identity protections that keep one path's end from touching another path's records.

## Goals / Non-Goals

Apply one rule to all paths without a second reducer, registry or timer. Do not change native modes, add provider families, replay history or clean up per device. Do not infer ends from idle/unknown activity or transcripts.

## Decisions

1. Remove the provider/client gate rather than enumerate paths. The selector already namespaces records, so ending `claude`/`code` `shared` cannot touch `codex`/`cli` `shared`. Retirement is one `retire(roots, at, end?)` step shared by live ends and startup settlement; guards, generation and descendant collection are unchanged from #218.
2. Keep archive admission Desktop-specific. The host callback already filters to Desktop identities, and the owner still probes only for a new Desktop identity; Claude and CLI admissions never probe.
3. Settle stored accepted ends at startup using activity `ended` only. That value was written solely when the previous owner accepted a `runtime.ended` it did not retire (ordered end, or an end on unknown activity). The packaged hooks supply no ordering, so an end after a turn on an active or idle record left activity `unknown` with only a bounded diagnostic journal row; that row is deliberately not used as authority, so such records keep the 24-hour fallback. Settlement runs inside maintenance after expiry and before approval settlement, records guards without an own-end key/turn, adds no journal row, and takes one replacement that also migrates a format 1.0 store unless expiry already did.
4. Drop the reducer's `runtime.ended` branch. The owner handles every end before reduction, so the branch was unreachable; the `ended` value stays in types and schemas for older stores only.
5. Record the Claude and Codex documented end/start mappings per path without copying reason or source into the envelope; the normalizer already drops them and a test now asserts it.

## Risks / Trade-offs

- A Claude or CLI end delivered late for a resumed session with the same session ID is guarded by the retained turn/retry/order evidence exactly as for Desktop; unknown-ordering limits and bounded history are unchanged and documented.
- Settlement removes known descendants of a stored ended parent even if a child has later evidence, matching the live rule. Records whose accepted end left only ambiguous activity are indistinguishable from other conflicts and expire normally.
- Installed emission of SessionEnd on exit, `/clear` and resume for CLI/Claude remains unobserved; missing ends fall back to expiry, never to an invented end.

## Migration Plan

No durable format change. Opening an existing 2.0 or 1.0 store with Agent State 3.2.0 settles stored ended records once, preserving clocks. Compatibility is one-way: the 3.0 and 3.1 validators reject Claude and CLI retirement guards, so those owners fail closed on a store or export holding one until it expires, 24 hours after the retirement. Rollback to them follows the existing owner handoff rules after those guards expire, or through an explicitly reconciled export; an older owner would again retain Claude/CLI ends until expiry. Source checks use disposable stores; no installed store is opened.
