## Context

See proposal.md for the observed #734 activation failure. Intake and closeout currently hash buffered private-file reads. The native Hub file helper already streams SHA256 in 64 KiB chunks, opens without following the final symlink, rejects nonregular and multiply linked files, and checks size and modification metadata after reading.

## Goals / Non-Goals

Use that helper for trusted fingerprint entries in both maintenance consumers. Preserve private JSON/evidence limits, hashing mismatch errors, the supervisor protocol and all runtime authorization boundaries. This source change does not activate the loop or alter the installer helper's default.

## Decisions

- Export one maintenance fingerprint function that calls the existing helper with a 512 MiB maximum. This covers the observed native executable with finite work and fixed memory. Raising the general buffered-read limit would allocate large buffers and weaken unrelated evidence limits; copying the helper would duplicate its safeguards.
- Keep unsafe-file exceptions blocking and preserve each consumer's existing mismatch reason. Resolved regular paths remain mandatory; loading-link identity is separate host evidence.
- Use a sparse file of the observed executable's size and compute expected SHA256 with a small zero buffer. Exercise both callers without launching a model. Add oversized, drift and nonregular cases; the existing package fixture will also carry a sparse trusted file through the bundled consumers.

## Risks / Trade-offs

- More bytes must be hashed before invocation → cap each trusted file at 512 MiB and retain the outer supervisor process deadline.
- Reuse introduces a source import from the existing Hub helper → maintenance already bundles Hub installer helpers; build and extracted-package checks verify the dependency closure.
- File mutation during hashing → reuse the helper's byte-count and stable-stat checks; digest mismatch still refuses a changed configuration entry.

## Migration Plan

Build and validate the maintenance package, then deliver it through the existing reviews/CI and #734 stopped installation boundary. Root refreshes fingerprints and package readback before activation. No persisted state schema or private configuration schema changes.
