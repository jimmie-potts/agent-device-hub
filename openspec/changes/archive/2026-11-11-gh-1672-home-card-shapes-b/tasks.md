## 1. Contract and catalog

- [x] 1.1 Add optional `FrontendContext.presentation` to the SDK frontend types and set it in `ModuleFrontend` from the
  Home card box. Evidence: `npm run build`, `npm run typecheck`, `npm run test:package`.
- [x] 1.2 Offer all four shapes for Pixoo, Tidbyt and Wispr with a generic-face fallback that keeps the stored shape.
  Evidence: `home-catalog.test.ts` (offered shapes, fallback, conversion of a Wide Pixoo placement).

## 2. Module compact content

- [x] 2.1 Red first: `home-shapes.browser.ts` part `modules` fails on main because Pixoo offers only Small square.
- [x] 2.2 Pixoo, Tidbyt and Wispr compact content per shape. Evidence: part `modules` passes at 1100, 1440 and 1920 px
  (no spill, no generic face, no blank band, two idle seconds), and a Wide Pixoo Screen off sends one command whose
  result shows on the card.
- [x] 2.3 Update `pixoo-cards`, `tidbyt-card`, `wispr` and smoke journeys from the generic face to the compact cards.

## 3. Documentation

- [x] 3.1 Dashboard README, runtime DEVELOPMENT.md, SDK README and the Pixoo, Tidbyt and Wispr module READMEs.
- [x] 3.2 Sync the `home-layout` delta and archive this change on the delivery branch.
