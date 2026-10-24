## Context

See proposal.md for the approved outcome and #1210 for acceptance. The existing frontend owns `onn-state` sync and renders raw controls; Home uses a generic device card. The shell already supplies module-scoped APIs and a shared per-target Command attempt store. ONN has one configured owner, guarded actions and retained history; none needs a new transport or store.

## Goals / Non-Goals

Goals are a pure reusable Soft keys presentation, a module-owned adapter and truthful shared placement. State acquisition and command identity stay outside the pure card. The existing module/backend, reader artifacts, history semantics, settings and primary navigation stay unchanged. No physical command sequence or real-device appearance is qualified here.

## Decisions

1. Export the card and adapter from the existing frontend entry. The card receives status/capabilities/callbacks; the adapter retains one status sync on the authenticated shell participant. Home wraps the adapter with an explicit expected target and configured label. This follows the shipped Wispr/Pixoo patterns without extending the SDK contract or building a widget framework.
2. Keep the existing Command component and per-target request store. Callback guards recheck current control permission, source lifetime, selected target, operation freshness and declared capabilities. The frontend retains no action for replay. Current-app labels derive only from actual observed state and a presentation clock; that clock makes no network read.
3. Use a fixed control-plane height and a persistent CSS TV/box illustration over semantic glass tokens. Remote/Apps selection changes local controls only. Preserve focus, input constraints and useful focus-dependent guidance through concise accessible help. A corner disclosure exposes safe command/status detail; ordinary no-command text is omitted. Full protocol feedback stays available even when the normal face uses concise status.
4. Add one declared `history` React page using the existing History component. A native History link then has a correct owning destination without extending the global router. Keep the original controls URL's history UI for compatibility. A new history backend API, modal-only copy or general anchor/query routing would add unnecessary behavior.
5. Keep transient text only in card memory, clear it before dispatch and clear it on unmount. Hide/re-entry closes only this adapter's scoped reads. Conflicting identities or same-revision contradictions make controls stale until a fresh explicit sync; obsolete callbacks cannot revive a closed view.

## Risks / Trade-offs

- Compact feedback could hide uncertainty → retain the shared lock/outcome, safe detail and Inbox guidance; test HTTP-only uncertainty across reload and placement changes.
- A Home source could mismatch the module's configured target → validate both identities and current catalog/owner evidence before dispatch.
- App launch could be mistaken for an observed app change → derive labels only from sync, including expired and future-dated observations.
- Fixed geometry could clip text/input errors → test both tabs and fault states at desktop/phone widths, with axe, keyboard and full-document bounds.
- Moving history could break an accepted URL → add a focused owning history page and keep the current controls page's history rendering.

## Migration Plan

No data, configuration or protocol migration. Validate source and synthetic consumers, synchronize/archive the issue-linked delta, obtain independent reviews and exact-head CI, then guarded merge and all applicable main CI. Use the qualified routine upgrade on the established target with a focused UI/additive-page assessment, complete stopped-state backup and passive installed readback. Preserve recovery eligibility independently; no downgrade, snapshot restore, device command or source activation follows from this UI delivery.
