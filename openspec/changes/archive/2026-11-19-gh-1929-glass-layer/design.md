## Context

Home renders its cards as React elements on a CSS grid (`home-layout.tsx`, #1672). The accepted Clear reference draws the artwork and the glass with one fragment shader. The style guide allows a drawn layer on the dashboard (owner decision 2, PR #1936). The art module hands the shell a decoded backdrop image through #1928 (`useArtBackdrop`, `useShowArtBackdrop`).

## Goals / Non-Goals

**Goals:** the reference's flat glass on every Home card; Quiet glass when WebGL 2 is unavailable or lost; no frames at rest; readable text over any artwork; a layer other pages can reuse (#1950) and later stories extend (#1930 to #1933).

**Non-Goals:** lit panels, wobble, the mode thumb and drag (later stories); new card faces (#1934); a CSS imitation of the glass.

## Decisions

- **One component, a scanned scene.** `GlassLayer` (`glass-layer.tsx`) is rendered inside a root that carries `data-glass`. It reads `data-glass-panel` elements inside the root and `data-glass-veil` elements in the document into a typed scene (`glass-scene.ts`) once per frame. Later stories add optional panel fields parsed from more attributes, a texel per field in the renderer's panel table and a shader term. A context hook was considered; a scan needs no per-card wrapper component and lets module cards stay unaware of the layer.
- **Options, not page code.** `backdrop` (a picture or null for the wash) and `fuse` (the smooth-minimum join) are props; Home passes the art backdrop and `fuse`. Other pages pass neither and get separate panels over the wash.
- **State on the root.** The page writes the reported state to `data-glass` (`quiet` until the first frame is drawn, `webgl` afterwards). All CSS keys on it, so Quiet glass is the default and needs no rule.
- **Panels in a data texture.** An `RGBA32F` texture of `PANEL_TEXELS` by 128 rows holds the visible panels (Home's placement limit), read with `texelFetch`. Uniform arrays would exhaust the minimum uniform budget once lights and motion are added.
- **Drawing discipline.** A frame reads boxes and tokens only when an event marked them dirty (scroll, resize, ResizeObserver, a mutation of the root, fonts, the appearance or art theme) and draws only when the read differs, the backdrop changed or the 700 ms first appearance runs. The pixel ratio is capped at 2.
- **Colors from tokens.** The layer resolves `--glass-*`, `--bg` and the wash tokens through the computed color of hidden probe elements, so `light-dark()` and the art theme apply. An alpha carries the amount the shader uses.
- **Automatic veil.** Inside panels and under veil marks the shader mixes, in linear light, just enough of the veil color to reach 5:1 against `--glass-ink` (the faintest text, `--muted-dense`). Behind headings the amount follows the brighter of the pixel and a 40 px neighborhood so the veil stays smooth.
- **Wash in the shader.** Without artwork the shader draws the shell's wash on the scrolling page box from the same tokens as `--shell-background`, so the backdrop matches the Quiet look.

## Risks / Trade-offs

- [SwiftShader is slow] → the journey waits for rest by frame count, not by time; the drawing work is bounded by the visible panels.
- [A card surface with a fixed state meaning] → the Inbox attention surface wins over the transparent rule and keeps its fill.
- [Bitmap lifetime] → the art source closes replaced bitmaps after commit, so the layer uploads a new image in a layout effect and, after a context restore, re-uploads only the current image.
- [Synthetic art is dark and small] → the journey serves dark and bright synthetic pixels through the real content route, padded to the rendition's byte count.

## Migration Plan

None. No stored state changes. Reverting the change restores the Quiet glass Home.
