## Context

See proposal.md. The companions module already owns an exclusive SDK SQLite connection, one sync revision sequence, an outbox and the `assistant-input/2.0` private staging path. The SDK supports one upload contribution per module. Significant persistent/private data changes make this design artifact applicable.

## Goals / Non-Goals

Keep one authoritative store and a small preference interface for the dashboard and #636. No model, recorder, database service, generic import framework, permanent erasure or installation is part of this source change.

## Decisions

- Add private preference/history, staging and receipt tables to the existing connection. Store full inspectable entry records; commit mutations, revision and outcomes together in the existing outbox transaction. Retain original snapshots in history, without event sourcing or another writer.
- Reuse the existing opaque `assistant-input` envelope with target `preferences`. The module dispatches uploads by target, leaving `assistant` bounds and behavior intact. A new command family would require expanding the SDK's single-upload interface solely for this page; the existing envelope already supports distinct subjects without transmitting text.
- Add only `preference-state/2.0` with ID and revision to the existing sync owner. Private reads provide active current values, management history or a versioned export. Event-driven invalidation and reconnect refresh replace polling. Copy rereads active values before constructing selected text.
- Validate closed versioned JSON and duplicate IDs before import. Match only stable IDs, preserve existing records exactly, append an import snapshot with inactive state to missing entries, and perform all additions in one transaction. No semantic conflict UI.
- Bound title/text at 200/4096 UTF-8 bytes and the serialized retained library at 8 MiB. Refuse capacity without truncating history; leave retained data readable/exportable. The existing gateway's 10 MiB upload and 16 MiB content ceilings remain unchanged. Import may refuse when imported history plus local records exceeds capacity.
- Bind staged input to request ID and expected preference revision; allow eight five-second pending inputs. Keep successful receipt identities privately, reject a changed request payload, and never replay staging on restart. Return existing typed error bodies and fixed details; no new telemetry contract.

## Risks / Trade-offs

- Historical text or an inactive entry could leak into copied context → active-only read and copy tests, separate management/export route modes, no automatic model integration.
- Old export could overwrite newer intent → stable-ID skip rule and repeat/old import tests.
- Lost reply could invite duplicate mutations → durable receipt identity plus existing tracked command UI and no automatic resending.
- Persistent history reaches the finite library limit → refuse additions without erasure; surface the capacity code. Larger libraries require a separately justified extension.
- Imported provenance is supplied data, not trusted permission or factual evidence → preserve attribution, render text as text and exclude it from authority decisions.

## Migration Plan

Add tables in the existing store without rewriting assistant/Reachy data. Source tests reopen a preexisting module database. No installed migration runs in this delivery; #508 owns installed adoption. Preserve tables on source reversal; no destructive down migration or snapshot restoration is selected.
