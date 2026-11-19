## Context

The Art widget (`ArtImage`) reads one browser rendition through `api.image`, validates its bytes, media type and dimensions, decodes it to an `ImageBitmap` and publishes transient presentation evidence that drives the art theme. Home's backdrop needs the same decoded image outside the widget, and the shell may use only the module's frontend exports (ADR 0016 rule 2).

## Goals / Non-Goals

**Goals:** one module export that hands the shell the decoded presented image with its identity and readiness; the widget's validation and selection rules unchanged; combined evidence from both surfaces.

**Non-Goals:** drawing the backdrop (#1929); moving the Art card out of Home's grid (#1930); a shared image cache between the widget and the backdrop.

## Decisions

- **The backdrop loads the largest still.** The widget's card rendition (768x512) would be upscaled to fill the page, so the source loads `browserArt(artwork, false)`. The real browser composition always has both, so the backdrop never repeats the widget's request. Rejected: reusing the widget's card bitmap.
- **One loader owns the race rules and bitmaps.** `backdropLoader` is React-free so unit tests drive it with a fake `FrontendApi` and decoder. It keeps the last ready image, lets only the latest wanted load publish, reuses a decoded bitmap when another artwork names the same rendition, and closes a replaced bitmap only after the consumers' commit reports the new image. All its bitmaps close on unmount.
- **Shared code, not copies.** `loadBrowserArt` (fetch, validate, decode) and `useBrowserArt` (stable selection) are factored out of `ArtImage` and used by both surfaces.
- **Combined evidence.** The provider keeps the widget's evidence and the backdrop's (derived from the rendition the shell reports drawn) apart and combines them: ready displayed art wins, then any displayed art; an idle surface never erases the other.
- **Mount condition.** The shell mounts the source on Home while the module catalog lists the art module as running, with the Art card's connection condition as `connected`. A dropped feed then reports `stale` with the previous image instead of discarding it; the module stopped unmounts the source and reports `none`.

## Risks / Trade-offs

- The widget and the backdrop each follow the art record while the Art card is still on Home's grid, so Home holds two art syncs and decodes two renditions until #1930 removes the card.
- A hidden element in Home states the backdrop's status and identity for browser checks. It is not visible and carries only identifiers already shown on the widget's figure.
