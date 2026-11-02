## Context

The release producer uses Docker's local image ID for build/test/save and copies it into image metadata. The established Mac's containerd store resolves the saved OCI manifest instead of the producer's configuration digest. The issue's retained hash chain and never-started disposable container prove both identifiers belong to the same image, while the existing strict consumer correctly refuses the old receipt.

## Goals / Non-Goals

Generate new metadata with the verified saved manifest identity and retain exact production-parent, source and archive binding. Preserve every consumer/helper/container comparison and the existing receipt schema. Existing receipts, failures and installed state are unchanged. Legacy-store translation, additional hosts, registry adoption and Docker settings are outside this change.

## Decisions

Keep the existing producer-local image validator and Docker handles. Extract the existing metadata path as `savedImageMetadata(archive, candidate, productionInfo)` so a real archive fixture can demonstrate the old config-ID result before the correction.

Add one release-specific streaming gzip/tar reader. Existing backup facilities archive directory trees and provide no reusable tar reader. Accept the demonstrated USTAR regular-file/directory layout, with no extraction or new dependency. Bound compressed and decoded bytes, entry count, retained metadata and elapsed time. An inner gzip write observes its callback, stream failure or closure, and cancellation; it removes those listeners when the write settles so decompression failure cannot strand the archive deadline. Reject links, duplicate or unsafe names, malformed headers, truncation, unsupported entries and ambiguous image graphs.

Hash raw blob bytes and verify descriptor sizes. Select exactly one OCI image manifest, verify its configuration digest and compare the configuration's ordered DiffIDs, source revision, Linux ARM64 platform and user `1000:1000` with the tested production image. The producer-local ID must bind to that configuration or the exact selected manifest. Validate the Docker compatibility view against the same configuration and layers. For gzip layers, verify their decompressed DiffIDs separately from their compressed content digests. Unknown layer encodings refuse.

Return the selected manifest digest and exact compressed archive hash to the existing metadata emitter. Keep the receipt fields and strict consumers unchanged. The new ID matches the selected Mac's actual image and container identity; this does not promise identical Docker IDs across all storage backends.

No runtime event, error registry or diagnostic schema changes are needed. Archive refusal uses the producer's existing failed/incomplete finalization path under ADR 0012. No retry, installed effect or recovery action follows from refusal. Fixtures remain synthetic, and actual artifact records remain private under ADR 0011.

## Risks / Trade-offs

The reader deliberately rejects unsupported tar/OCI shapes instead of guessing another image. Finite limits exceed the retained 29-entry, approximately 1.5 GB decoded archive. Streaming hashes avoid buffering layers or extracting paths. Tests cover real metadata emission, compressed-layer identity and malformed/ambiguous input. Real hosted qualification and Mac artifact consumption remain issue-owned gates after source delivery; the source change cannot satisfy them in advance.
