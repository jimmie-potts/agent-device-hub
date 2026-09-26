## Context

See proposal.md for motivation. The wall map's renderer (`bridge/prism.js`, dependency-free DOM and SVG, an IIFE on `window`) draws from a version-1 connector layout: nodes with positions, Lines joining two nodes with two zone ids and two colors. Its wall-state adapter reads the bridge's private state. The hub's geometry route gives the same connector graph plus each element's display points, and the hub's `nanoleaf.integration/1.0` snapshot gives mode, project colors and per-element project reservations, but neither task placement nor task status. The dashboard is React/TypeScript bundled by esbuild into one file, reads colors only through the skin token layer, and polls each device every 5 seconds through a one-slot per-device client.

## Goals / Non-Goals

**Goals:**
- One hub-owned component (`apps/dashboard/src/art/`) that the device pages use now and the home miniature and group page can use unchanged.
- The wall map's look, timing and interaction distinctions, so the side-by-side review compares the port, not a second design.
- Honest presentation of what the hub can see today, with inputs for what it will see later.

**Non-Goals:**
- Measured number placement (`prism-labels.js`), Locate, reservations and other controls on the art, group-page layout, art for other devices.
- Any change to Nanoleaf's snapshot or the hub routes.

## Decisions

- **Port as a TypeScript ES module, not a script tag.** The renderer becomes `art/prism.ts` with the same public API (`Renderer`, `validate`, setters, `destroy`) and typed layouts, bundled with the dashboard. Alternative: copy `prism.js` verbatim and load it as a global; rejected because the dashboard has one bundle, typechecks its sources, and a global would leak the wall map's page assumptions.
- **Hub adapter instead of the wall-state adapter.** `art/nanoleaf.ts` maps the hub geometry (connector nodes and lines, element zones and numbers) to the Prism layout and the snapshot to presentation. Colors follow the wall map's rule: the status color on both zones, and in the project layout style the signature zone takes the reservation's project color. With no status source the base status is the wall map's own "no task" reading, so a Line without a task looks the same in both interfaces.
- **Status and activity are inputs.** The component takes an optional status map and activity set. The pages pass none today; the browser harness and the future consumers pass them. Alternative: derive status from the monitor sessions through `sharedIdentity`; rejected because placement (which Line shows which task) is still unknown, so a derived status could not be drawn on the right element.
- **Panels are triangles in the connector pane material.** The Prism kit has tubes and hexagonal connectors only; the triangles reuse its pane gradient, edge stroke and glow filters, take one color per element, and pulse by opacity on the shared two-second clock in Work. Alternative: draw the Panels in the schematic strip; rejected because the issue asks for the 18-triangle fixture to be drawn as art.
- **Geometry is read once per component.** After the first successful snapshot the page reads the geometry route once; a failed read is retried after the next successful poll; a 422 from an owner without the route is final for the session. The hub validates the geometry's shape, not the renderer's drawing rules, so the host catches a rejected layout and falls back to the strip, or keeps the last drawn layout. Alternative: read on every poll; rejected because a second read per poll collides with the one-slot device client (#354) and layouts rarely change. Reopening the page rereads it.
- **Tokens.** `--wall-*` and `--chip-*` move into the application skin as fixed-meaning tokens (style guide section 4.2); the crystal material's own gradient colors stay inside the renderer source, as they do in `prism.js`, because they are the material, not a role.
- **Opening assembly plays once on first view, not on every poll.** The renderer keeps its layout across snapshots; only colors, mode, activity, pending and labels update. Reduced motion skips the assembly.

## Risks / Trade-offs

- [The live page shows no status marks until Nanoleaf publishes placement and status] → said in the page caption and the issue's assessment; the harness proves the inputs work.
- [Two renderers to keep in step with the wall map until it retires] → provenance records the source revision and hashes; the wall map keeps its copy under ADR 0007 until retirement.
- [Numbers without measured placement may overlap a neighbour on dense layouts] → numbers show only on hover, focus and selection; the wall map keeps measured placement.
- [A hidden section keeps the renderer paused] → the renderer's visibility observer resumes it when the page is shown; the React host destroys it on unmount.

## Migration Plan

None: source only. The installed hub picks the component up at its next upgrade; no state or route changes.
