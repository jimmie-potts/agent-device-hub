# Prepare and publish the private apartment

The Rooms page reads one prepared apartment through the core. It uses the
existing Rooms assignments and live device owners for fixture controls. Keep the
original floor plan, scans, artwork, editing source, real names and bindings in
owner-private storage outside Git, build output and GitHub. Source checks use a
fictional apartment.

## Prepare the model

1. Create a private working directory (0700) outside all checkouts. Keep
   originals and preparation inputs in it or in a private archive. Keep each
   input file owner-only (0600), with one link and no symlink in its path.
2. Compare the floor plan with a selected length measurement. Check its
   orientation and mirroring against known features and compare room
   dimensions against the survey. Record the reference and the provenance
   of geometry that remains uncertain. Resolve geometry conflicts before
   publication.
3. Trace room footprints, walls and openings with the selected plan tool.
   Use the existing room IDs from Rooms and stable IDs for walls, openings
   and objects. Record simplified furnishings and curated artwork and
   fixture poses. Author or convert the trace and placements into the
   normalized JSON described below and run `calibrate`.
4. Deliberately capture and export one room at a time. Keep each original
   capture/export and its normalized input. The selected capture app and
   export format must be verified privately. The helper reads normalized
   survey JSON. Raw plan images, GLB and RoomPlan exports require conversion
   in the private workspace before using this helper. Verify the resulting coordinates and alignment against
   the original plan and selected measurements.
5. Export the selected artwork as stripped, static, noninterlaced 8-bit RGB
   or RGBA PNG. The prepared PNG has only IHDR, IDAT and IEND chunks. Strip
   metadata in the editor and retain the original separately. Calculate its
   SHA-256 digest and store the rendition as `assets/<digest>.png` beside the
   candidate document. Update the matching artwork object and asset entry.

Build from a qualified or disposable source checkout with Node 24. Supply
absolute paths to the private inputs and a new output ending in
`.candidate.json`.

```text
node apps/runtime/bin/apartment.mjs calibrate ABSOLUTE_PLAN ABSOLUTE_BASE_CANDIDATE
node apps/runtime/bin/apartment.mjs replace-scan ABSOLUTE_BASE_CANDIDATE ABSOLUTE_SCAN ABSOLUTE_REFINED_CANDIDATE
```

The plan schema is `apartment-plan/1.0`. It uses the prepared document fields
below with `scan: null` for each room, and coordinates and lengths in one
consistent plan unit. `calibration.planId` identifies the private source without
exposing its URL or filename. Set `planUnits` and `referenceMeters` to the
same reference segment expressed in plan units and meters. Set `source` to
`measured` or `inferred` and `orientation` to `confirmed`, `inferred` or
`unresolved`. Calibration applies the ratio once and produces
`apartment-model/1.0`.

For a normalized survey, supply `{"schema":"apartment-scan/1.0","room":{…}}`.
The room has the same shape as a prepared room. Supply its footprint, local
floor elevation, wall endpoints and all lengths in scan-local meters.
Set its `scan` to `{id, yaw, translation}`, where `id` identifies this
capture revision and `translation` is an XYZ displacement in apartment
meters. Choose corresponding scan and apartment landmarks. Remove any
mirroring and normalize units before export. Positive yaw rotates +X toward
−Z and the helper applies translation after rotation. Check multiple
landmarks and remeasure conflicting dimensions. A corrected scan uses a new
scan ID. Keep existing wall and opening IDs and add new ones for new detail.
The helper leaves other rooms and the curated object IDs, positions and
bindings untouched. It refuses incompatible identities and overlapping
room interiors on the same level. Resolve
placement conflicts in the private plan before creating the next candidate.
Keep both candidates and the input scan to compare their contents.

## Prepared document

The top-level fields are `schema`, `calibration`, `rooms`, `objects` and
`artwork`. The prepared document uses meters with +Y up.

- A room has `id`, `footprint` (a simple polygon of XZ points in boundary
  order), `floorY`, `source`, `walls` and `scan` (the applied alignment or
  `null`). The first footprint point is implicit at the end.
- A wall has `id`, `start` and `end` (XZ points), `height`, `thickness`,
  `source` and `openings`. Each opening has `id`, `kind` (`door`,
  `window` or `opening`), `offset`, `width`, `bottom`, `height` and
  `source`. Its `offset` runs from the wall start. Its `bottom` is above
  the room floor. Preserve openings where two rooms share a partition. Use
  matching wall coordinates and opening geometry when surveying both sides.
- An object has a globally unique `id`, `roomId`, `label`, XYZ box center
  `position`, XYZ box `size`, `yaw` in radians and `source`. A
  `kind: furniture` object has a `form` such as `sofa`, `chair`, `table`,
  `bed`, `cabinet`, `shelf`, `desk`, `rug` or `other`. A
  `kind: artwork` object has an `asset` digest or `null`. Its face is
  local XY facing +Z. A `kind: fixture` object has a `form` of `ceiling`,
  `wall`, `floor`, `table`, `strip` or `other`, and exact `deviceId`
  and `owner` routing fields, or both fields `null` for an unbound fixture.
- `source` is `measured`, `inferred` or `unresolved` for rooms, walls,
  openings and placed objects. Use tighter provenance only where evidence
  supports it.
- An artwork entry contains `id` (the lowercase 64-character SHA-256 digest
  of the prepared PNG), `width`, `height` and encoded `bytes`. Each entry
  must be used by an artwork object. The model supports at most 16 artworks,
  1 MiB and 1024 × 1024 pixels per image, and 4 MiB and 4,194,304 decoded
  pixels in total.

The model is capped at 512 KiB, 16 rooms, 128 walls, 128 openings and 160
objects. The dashboard limits prepared rendering to 120,000 vertices
and caps its canvas at about 2 million pixels. It decodes one artwork
at a time within the model's total image budget. The
[synthetic fixture](tests/fixtures/apartment.ts) demonstrates the document.
The existing room-model/1.0 files continue to work alongside the apartment.

## Publish when the runtime is stopped

The deployment owner selects a qualified image and the exact state volume,
holds the current core stopped under the
[Mac maintenance procedure](../../docs/bunny-container.md#hold-the-core-stopped),
and keeps the operation and state ownership for the publication window. Keep
config and secret mounts out of the helper. The helper runs as the runtime user
with networking disabled, on the existing state volume and the read-only
candidate directory. The built image includes the entry file and its compiled
runtime dependencies. The helper uses the existing core lease and refuses a
missing or held lease. It never starts or stops the runtime.

For example, run the helper with the exact stopped state volume and the
qualified image ID selected for the maintenance window:

```bash
docker run --rm --pull never --network none --read-only --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount type=volume,source=SELECTED_STATE_VOLUME,target=/var/lib/bunny \
  --mount type=bind,source=ABSOLUTE_PRIVATE_CANDIDATE_DIR,target=/private-apartment,readonly \
  --entrypoint node QUALIFIED_IMAGE_ID /opt/bunny/apps/runtime/bin/apartment.mjs \
  publish /var/lib/bunny EXPECTED_ACTIVE /private-apartment/refined.candidate.json
```

Use the same invocation with `status /var/lib/bunny` in place of the last
line to read the active digest before and after publication.

Use the observed digest for `EXPECTED_ACTIVE`, or `none` when status returns
`null`. The candidate and its sibling `assets` directory must be visible to
UID 1000 with private permissions in the maintenance container. Confirm those
permissions before the window. The helper validates all geometry and artwork
before activating it, retains the old usable JSON by digest and retains its
artwork. A failed validation or cancellation before activation keeps the
previous active model. An interrupted or uncertain result after activation
requires status readback before another attempt. Status reports the visible
digest. Compare it with the candidate and the previous digest. If it matches
the candidate, an explicit publication of the same candidate with that digest
confirms the active file's durability under the lease. If the observed digest
matches neither, keep the working files and inspect the selected state before
choosing a next action. Keep these operational records private.

The dashboard reads `/modules/core/content/apartment-model` and
`/modules/core/content/apartment-art-<digest>` using the authenticated SDK
content API. Only the active model and referenced prepared artwork are served.
A missing artwork image uses a frame placeholder. Missing content or failed
WebGL leaves the ordinary room controls available. The dashboard uses its
existing SDK observations and loading or inspecting a model sends no device
commands. After publication, verify the running identity and health, verify
the actual phone view and inspect the private furniture, artwork and fixture
layout in the separately selected deployment. Device exercises need their
own explicit sequence and targets.
