## Context

The core serves private room-model/1.0 JSON and the dashboard consumes current room assignments and observations to resolve individual LightCards. ADRs 0011, 0012 and 0016 govern private files, existing authenticated boundaries and one authoritative core. The apartment needs shared coordinates and artwork that the original single-room model cannot express.

## Goals

Keep the plan, aligned scan refinements, objects and bindings independent of the browser renderer. Use the existing authenticated content and lighting paths. Bound a single apartment and its artwork to fit phone use.

## Decisions

- Use one additive apartment-model/1.0 document. Its +Y-up meter frame contains room footprints, walls and openings. Plan reference length establishes scale. Surveyed geometry carries provenance, and each normalized scan carries a per-room yaw and translation. Prepare plan and vendor exports privately after checking scale, orientation, mirroring and conflicts. A scan update replaces selected geometry under stable IDs and verifies the existing curated object placements still fit. It preserves the untouched room records and all placements and bindings.
- Serve artwork by SHA-256 digest through existing core content and SDK image reads. Keep only static bounded PNG renditions in the active document. Require exact dimensions, lengths and content digest. Preserve originals in an owner-private working folder outside the served area.
- Run the publication helper with the stopped runtime's existing state lease. Prevalidate the model and every asset. Stage immutable prepared assets, retain the active version and atomically replace the active model as the final operation. A caller supplies the expected model digest and reads back the active digest after an uncertain interruption. Existing gateway traces and refusal codes cover content reads, with no raw file paths or private payload in diagnostics.
- Render one WebGL dollhouse on Rooms. Build floor and wall geometry and simplified furniture from semantic shapes. The camera and renderer consume placement and presentation state. The workspace supplies observation labels and invokes the same guarded individual LightCard by room and binding. Scope image reads to page lifetime and release model and texture resources on exit.

## Risks and trade-offs

Room scans vary by app and export. The normalized preparation input requires explicit conversion and review before alignment. A transformed wall or floor can conflict with a curated placement. Reject a publication that would leave mismatched geometry and keep the previous version. Missing images should leave their frames and controls usable. Schematic light emphasis carries no physical lighting or scene-color claim.

## Migration plan

Enable the additive reader and Rooms view without converting existing room-model/1.0 content. Private deployment prepares and checks the selected content, publishes under the owning maintenance procedure and verifies the installed client separately.
