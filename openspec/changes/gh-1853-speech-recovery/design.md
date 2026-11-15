## Context

See proposal.md. Startup converts pending speech to uncertain and retains no endpoint or active candidate. The current indefinite reservation has no operator recovery. This change affects persistent state and writer exclusion, so the schema's design criteria apply.

## Goals / Non-Goals

Recover only an orphan from startup. Live attempts still require Stop/mute and definitive receipts. No timeout is treated as proof of silence; no playback outcome is rewritten.

## Decisions

- Add endpoint-control/2.1 recovery with an exact operation ID, expected state revision and explicit `previousPlaybackStopped: true`. Keep 2.0 registered. Speech-state/2.1 advertises a recovery operation only for startup orphans. Existing authenticated connection-bound SDK routing owns access, expiry and trace context.
- Save one acknowledgement per operation in an additive private table, with request, endpoint, time and trace identity. Commit it with the revision in a single SQLite transaction before accepting. Uncertain rows and candidate deduplication remain intact. Select only unacknowledged uncertainties for future reservation checks.
- Refuse stale, live or mismatched recovery with `invalid-state`; absent qualification with `unavailable`; unauthorized requests with `forbidden`; precommit storage failures with `capacity` or `internal`. Nothing retries. An ambiguous network answer requires a fresh state read, never resending. SDK diagnostics and existing storage logging follow ADR 0012 and the diagnostic contract, without playback text.
- UI requires an unchecked confirmation that playback in all earlier voice tabs is stopped or those tabs closed. It cancels local synthesis and checks idle before and after opening a temporary endpoint, sends recovery once, closes that endpoint and leaves speech off. A separate Enable action rechecks the qualified voice. A new operation cannot inherit an earlier acknowledgement.
- Recovery clears the current playback display; the old uncertain result remains in private speech records and tracked history. Keeping uncertainty attached to an available state would contradict the existing state invariant.

## Risks / Trade-offs

The browser cannot prove other tabs are silent. Explicit operator confirmation supplies that prerequisite; local idle alone never clears a reservation. Recovery during a live attempt remains refused. Multiple retained uncertainties require one explicit acknowledgement per advertised operation. A stale browser request cannot release the next one.

## Migration Plan

Create the acknowledgement table additively at module startup. Test an existing database with pending and uncertain rows, transaction rollback and a second restart. No old rows are changed or deleted. Deploy through a qualified Mac batch with backup and private storage assessment. Older source ignores acknowledgements and conservatively blocks again; recovery selection still follows the installed procedure, with no automatic rollback or snapshot restore.
