## Context

See proposal.md. The guide, atlas and reference use separate Python generators; the nine Archify viewers and the atlas state/action viewer are generated standalone HTML. The dashboard bundles a React page into the Hub's existing static assets. The public exporter changes the repository layout. Nanoleaf owns the wall map.

## Goals / Non-Goals

**Goals:** Keep labels, order, grouping and destinations in one reviewed manifest; preserve working relative links in source documents and public links in exported documents; keep all navigation static and responsive.

**Non-Goals:** Host documents through the Hub, authenticate public pages, open a loopback service on a phone, or implement Nanoleaf #189 here.

## Decisions

1. `docs/skins/places.json` owns six entries. Each has a stable ID, label, group and one destination for its public or local origin. Python validates it before rendering; the dashboard imports the same JSON at bundle time. This prevents generator-specific labels and URLs. Hard-coded links in each page were considered but would drift.
2. The shared Python skin renders a marked Places strip. For source files, it computes relative URLs among local documents and uses fixed numeric-loopback URLs for the two local applications. The public exporter replaces the marked block with public document URLs. This keeps local source browsing useful while making the copied edition independent of repository layout. Rewriting every page's unrelated links was rejected because the exporter already owns those separately.
3. The guide and atlas call the skin during generation. Reference generation injects the same block while retaining its own stylesheet. Archify output receives the block immediately after rendering, and the atlas state/action viewer receives it as a build post-process. A check compares the existing block to the expected block, so regeneration cannot silently drop it. The injected CSS uses shared fixed skin tokens where applicable and leaves Archify's diagram styles intact.
4. The dashboard imports the manifest into its existing bundle and renders ordinary anchors in the sidebar. Its current place is text; other destinations are links. No new Hub route or asset is served, and no controller call is made.

## Risks / Trade-offs

- [Public export retains a source-relative link] → Compare every exported Places block with the public renderer and check all exported HTML.
- [A generated viewer loses the injected block after an independent Archify render] → The guide/atlas checks fail until the post-process runs; regenerate and check before review.
- [Mobile strip crowds a document header] → Give the strip a wrapping layout and run 390 px browser and axe checks on each surface type.
- [Wall cannot link back yet] → Track the reciprocal link in Nanoleaf #189 and leave full six-place acceptance pending.

## Migration Plan

Commit manifest, generators, checked HTML and dashboard together. Existing document URLs and Hub assets remain valid. Reverting the source PR removes the added navigation; the separately owned Nanoleaf link has its own review and rollback. Public publication is a later owner-requested step from the exact merged Hub revision.
