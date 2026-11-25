# Device history read design

The core uses a bounded primary-key range of the existing fact log and takes the matching open spans in the same synchronous read. The result includes committed evidence identifiers, supported durations and defensible request links. An incomplete work window is explicit. Device state and deadline discovery continue to use the existing device and power-limit SDK copies.

Conversation checks the destination's device grants before opening a snapshot and before every subsequent page. Operation grants govern links. The cursor holds a short-lived bounded snapshot and binds the originating task, provider destination and normalized query. A restart requires a fresh read for an unfinished cursor. Tool replies already committed to the private task record retain their returned evidence and disclosure ledger. No new persistent cursor or writer work is introduced.

The bounded reader uses the existing sequence primary key. #1760 retains ownership of migration, optional-limit changes and general history indexing. Retained change rows and confirmation spans describe observed coverage. Time between unproven observations remains unknown. Device removals and gaps end coverage. An accepted dispatch is evidence of the request. A request link requires a tracked send, a successful transmission outcome, and a later matching request-tagged observation. The link supplies evidence of association. Multiple matching request tags leave the association unknown. Confirmation spans on metadata-only deltas keep their inherited observed power, bounded by gaps and removals.

A disposable in-memory SQLite fixture held 350,000 synthetic rows, with an
864-byte representative unrelated row and a matching observation every 400
rows. A past-day query returned 216 matching observations. Across 15 warm
reads on the Mac, median latency was 36.7 ms and the slowest read was 42.4 ms.
Process RSS was approximately 0.92 MiB higher after the reads. This compares
resident memory before and after the read loop. The projection adds no
index, migration or writer call. The established writer inserts the same
records with or without a reader.
