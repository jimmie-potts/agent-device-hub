## Context

The schema requires design for external dependency classification, archive compatibility and backup writer safety. The generic configuration walker currently treats every absolute string as a secret file reference and refuses ONN's declared host dependencies before producing an archive. Existing backup preserves original configuration bytes, hashes explicit secret references, checks a stopped writer's actual lease and verifies databases on disposable copies.

## Goals / Non-Goals

Permit the exact existing ONN configuration without reading its host dependencies. Preserve old archive verification and original source attribution. This adds no ONN configuration migration, host lookup, ADB operation, data transfer, live snapshot restore or completion claim for #1168.

## Decisions

Classify only the three exact JSON locations under `modules.onn` after its pure configuration validator accepts the section. A declared host dependency is recorded as configuration location and original path, with no metadata/content access, fingerprint recalculation or credential copy. Other absolute values retain the existing secret-root rule. The original raw config bytes/hash and secret reference checks remain authoritative; a changed config, secret or descriptor refuses verification. No runtime factory or transport is imported.

Write `bunny-container-backup/2` with separate `revision` for the old stopped runtime and `helper` revision/image identity for the actual evaluator, plus explicit external host dependency descriptors. Version 1 verification retains the legacy path classification. Version 2 verifies the exact descriptor list. Old readers refuse version 2 rather than accidentally accepting a changed archive meaning. Neither version changes stored runtime data.

The trusted host first reads the authenticated `main` ref once and compares the candidate against that exact pinned SHA. It requires matching candidate base/merge-base identities, complete comparison commits ending at the pinned main, zero behind commits and `ahead` or `identical` status. Unknown, unavailable, diverged or contradictory evidence refuses before downloading artifacts or loading an image. A later main advance does not invalidate that pinned ancestor. The candidate workflow's own integration check cannot establish this authority.

The qualified batch's existing authentic hosted API/artifact validation then admits a process-local maintenance-helper capability bound to the old container/image/revision, candidate image/revision and inspected integrated main. Plain JSON and raw worker-image values cannot substitute. The host operator rechecks the old target and the immutable helper's source/platform before running a fixed worker in that image, with the same old state/config/secrets mounts, no network and no device access. Old-source attribution remains old even though the helper is newer. Explicit standalone backup or existing empty-target restore can select the same path through a private qualification request; this does not authorize any live restore.

Use inspected helper identity in worker environment metadata, keeping the existing worker argv compatible with older images. A helper selected through qualification must return the new manifest/source/helper identities; an old or mismatched worker cannot claim the repaired guarantee. Ordinary same-image operations retain their existing route.

Emit only allowlisted existing refusal codes with fixed operational stages. Worker and host catches preserve machine-readable success stdout and map unknown subprocess failures to a fixed unavailable/worker result. Never repeat raw error text, input paths or subprocess stderr.

## Risks / Trade-offs

An archive can preserve an unavailable external dependency's declaration without qualifying that dependency. The guide and tests state this limit. A new helper reads old state only under focused same-format evidence and the existing lease; database checks still use disposable copies. Qualification is bound to exact authentic hosted inputs and image metadata, with no fallback to an arbitrary local image. Private manifests and operational records stay outside Git/GitHub.

## Migration Plan

Land the source prerequisites and repair under current gates, qualify an integrated candidate, then let the coordinating installation writer select the bounded helper and batch. Keep the installed full configuration byte-exact. Preserve existing version 1 archives; do not rewrite them or retroactively qualify ONN-stripped snapshots. No installed operation occurs during source delivery.
