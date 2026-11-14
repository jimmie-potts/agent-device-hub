# Public architecture overview

[Open the current overview](overview.html). This page owns the public architecture
entry point, separately from the retired Work Guide and dated atlas. The existing
runtime diagram and sync/outcome sequences are reused unchanged. The deployment
view describes the accepted Mac runtime; ADR 0016's cloud brain/local edges stay
explicitly future direction. History is a secondary footer destination, outside
the main diagram and section navigation.

Edit `overview.html` and `history.html` here. From the Hub root, stage into an
isolated checkout of `jimmie-potts/agent-device-guide`:

```sh
python3 docs/architecture-site/export.py /path/to/public-checkout
python3 docs/architecture-site/export.py /path/to/public-checkout --check
```

The exporter replaces the public root with a link/redirect to the current
architecture at its established URL, `architecture/arch-shared-system.html`.
It first preserves that URL's original diagram and the retired root Work Guide.
Existing archives remain untouched on subsequent exports. The Work Guide’s relative document links are relocated while its fragment
links continue navigating inside the archive. Other historical URLs and atlas files
remain available; they are not promoted into the current view. The atlas’s two
pinned-map links follow the archived viewer, and their manifest hashes are
updated without changing the historical source baseline. If the historical atlas
is exported again, run this architecture export last to restore those links.

`architecture/manifest.json` records the reviewed source baseline and SHA-256
hashes of the current export and preserved entry points. It is a source receipt,
not installed evidence. An export writes files only; publication uses a reviewed
public PR and successful Pages deployment. Verify the served files against this
manifest after publication. Update the review date/revision only after semantic
review; the reused diagrams retain their original generation provenance.

Check desktop and phone widths, light/dark themes, keyboard navigation, the
runtime iframe and standalone viewer, both sequence links, and the history
round trip. The current page must contain no legacy diagram or primary history
navigation. Keep screenshots and browser receipts outside Git. Run the retained
diagram consistency and independence checks; no runtime or device exercise is
needed for this documentation change.
