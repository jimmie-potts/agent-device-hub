## Context

Home packs cards on a unit grid from the saved layout (`home-shapes.ts`) and the glass layer (#1929, #1931) reads panel boxes from `data-glass-panel` marks once per frame, drawing only while something changes. The reference page's `refresh` (FLIP with 720 ms and a `linear()` overshoot) and `glFrame` (the liquid state `wob`) give the motion and its numbers.

## Decisions

- **Open state in Home's memory.** `home-layout.tsx` keeps one open card id and gives each unfoldable card (a light source whose saved shape is Small square, outside Edit Home, on the grid) a context with `open`, `toggle` and a one-shot focus request. The open card packs as Large square with the existing `packShapes`; the saved layouts are never touched, so nothing is sent or saved. Edit Home, a narrow screen or the Phone arrangement clear the id so it does not reopen later.
- **Edit Home closes it.** Card content is inert while editing anyway; closing keeps Edit Home showing the saved shapes.
- **FLIP on the card wrappers.** Before the change Home records every card's on-screen box; after the commit each card whose box changed animates a transform from its top left corner (Web Animations, id `home-unfold`), cancelling a move still running. Reduced motion skips it.
- **The layer follows animations.** A panel element with a running animation does not trigger a resize or a mutation, so the layer reads boxes every frame while one runs. Boxes read include the transform, so the glass follows the move.
- **Liquid on a time base.** `glass-liquid.ts` measures each panel's box from the layer root (so scrolling and anything above the page cancel out), takes the speed in px/s with 540 (9 per frame at 60 fps) as full, rises half the gap per frame at 60 fps (`-60 ln 0.5` per second) and decays by `exp(-3.4 s)`, snapping below 0.004. A window resize rebases the boxes after the layer's settle wait (#1967), so it stirs nothing and still draws one frame. Reduced motion keeps it at 0.
- **One texel, no new column.** `wob` goes in the free `.y` of the radius texel. The shader rounds corners toward a capsule by `0.6 wob`, displaces the edge by value noise up to 17 px flowing with a clock uniform, and widens the smooth-minimum join to `k (1 + 1.3 wob)`, as the reference does.
- **The arrow keeps its element.** It is the card's first child in both faces, so focus stays on it when the arrow closes the card; Escape moves focus back to it only when focus was inside the card.
- **Opened layout.** The dial, the lines, the page link and the options form one row beside the arrow, and the tabbed controls take the rest, so the Color face fits 2×2 with nothing scrolled. The page link is a light's component page, the Rooms page for a room, or a group's brand page.
- **Notices inside the card.** On Home the lighting workspace hands its stale layout notice to the card, which shows one line under the dial's state (full text in its title) or a wrapped line in the opened panel and two-row cards.

## Risks

- The liquid term adds a value-noise lookup per panel distance evaluation, only while a panel is liquid.
- Only boxes that change while a panel animates turn liquid. The reference stirs every layout change; here a box that jumps (Edit Home, a list page that changes a card's height) draws one frame as before, because under software WebGL every frame holds the page's main thread (review of #1971).
