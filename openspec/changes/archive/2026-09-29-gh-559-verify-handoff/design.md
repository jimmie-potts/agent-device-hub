## Context

See proposal.md for the owning issue and motivation. The core owns canonical proof roots, the receipt, freeze event and checksum manifest. Hub launchers own the disposable application process. Design is required by the schema because this change crosses modules and adds filesystem/network security behavior.

## Goals / Non-Goals

Serve a committed capture through the same listener that serves the preview, without adding a process or changing installed Hub configuration. Keep the receipt schema and external adapters' existing behavior. A proof browser, external consumer adoption and release publication are outside this change.

## Decisions

- Add resolved `proofDir` to adapter contexts and an opt-in `servesProof` declaration. Export a shared handler and URL builder in core 1.2.0. The core already owns root resolution and freeze semantics; copying those into each launcher would drift.
- Mount one reserved prefix on the Hub listener through an in-process extension used only by verification entrypoints. Share the existing request admission and shutdown path. A reverse proxy was rejected because it would rewrite Host/Origin and complicate SSE.
- Use the live receipt's committed freeze, the recorded manifest digest, the frozen receipt and its passed capture paths as the allowlist. Verify requested bytes against the manifest. Open directories and files without following symlinks, pin directory handles while descending, and never serve directory listings, receipt files, event logs or manifests.
- Allow GET and HEAD from the bound numeric loopback host. Check Origin when present; permit cross-site top-level navigation so a chat link works, but deny cross-site subresources. Serve PNG/JPEG/WebM/MP4 inline; force other formats to download with nosniff and restrictive CSP.
- Keep all serving reads independent of mutable runtime state. A reset recreates the private launch configuration and preserves proof paths. Reads never modify frozen files. Corrupt or incomplete proof fails closed; local files remain for diagnosis.

## Risks / Trade-offs

- Filesystem changes during a read could escape confinement or change bytes: pin each directory/file handle, reject symlinks and irregular files, and verify the exact bytes returned.
- Large media could exhaust memory: bound concurrent reads and buffer sizes; return an explicit refusal for an oversized artifact and retain its local path.
- Browser download/navigation policy differs between clients: test real browser media loading and navigation headers, retain the Windows-host qualification boundary, and provide attachments where supported.
- Lifecycle tests need real user systemd: keep portable server tests and a focused owner-host qualification separate; skipped tests cannot establish lease acceptance.

## Migration Plan

Build the new Hub source with core 1.2.0. Existing adapters remain compatible without opt-in; external 1.1 release pins stay untouched. Rollback is a normal source revert and rebuild. No installed runtime migration, personal configuration change or physical-device action is required.
