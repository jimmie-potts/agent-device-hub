## Context

See proposal.md. Shared core owns CLI and storage rules. Hub has a reusable buildCurrent read-only check. Pinned consumers use older cores. This shared interface and evidence distinction meet the schema's cross-cutting design criterion.

## Goals / Non-Goals

Goals: actionable local facts without state effects, explicit unknowns and backward-compatible adapter adoption. Non-goals: automatic repair, host probes, final readiness guarantees, browser/device acceptance, modifying old consumer repositories or changing run receipts.

## Decisions

Add a shared `inspectPrerequisites` operation and `prerequisitesSupport(help)` discovery helper. Each check has a stable kebab id, phase, status and non-secret detail. Runtime output includes version, read-only scope, separate phase summaries with operation unproven, and the first actionable next step. Exit3 indicates an observed missing local requirement; exit0 means the diagnostic completed, never that launch/capture/handoff passed. Invalid CLI input remains exit2.

Use read-only existing Git/root checks and a bounded systemctl state read. Test nearest existing storage parents with access heuristics and label successful access unproven for actual writes. Tool files and browser executable presence are prerequisite evidence only. Do not execute any application/network/lifecycle callback. A new optional `prerequisites.inspect` callback is contractually read-only; validate its output and hide raw thrown errors. Hub uses buildCurrent.

Version the additive source as 1.3.0 with unchanged app-verification/1 receipts. Update Hub's compose self-version and stand-in test manifests. Leave pinned real consumers at 1.1.0 and document unsupported diagnostic capability until their owners adopt. This is an explicit allowed #612 compatibility outcome, not completed consumer adoption.

## Risks / Trade-offs

- Permission heuristics race or omit filesystem policy → successful heuristics remain unknown for writes and start-time checks stay authoritative.
- Plug-in callbacks are trusted code → document read-only contract, validate output and test that mutating existing callbacks are never called.
- Browser modules may be missing or unreadable → retain missing/unknown, never launch to repair the result.
- An optional Windows executable is absent → distinguish interop tooling from actual human browser reachability.

## Migration Plan

Build/package the source, inspect help before requesting the new command, and use the optional hook only in owned adapters. Existing commands retain behavior. No settings, services or tools are installed. Qualify predictions against actual launches and captures under #613.
