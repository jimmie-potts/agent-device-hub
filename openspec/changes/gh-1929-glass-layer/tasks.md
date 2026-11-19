## 1. Glass layer

- [x] 1.1 Add the typed scene, the renderer and the shader; the layer draws the backdrop and flat glass for marked panels (journey: backdrop drawn, glass follows boxes).
- [x] 1.2 Draw only while something changes or eases, cap the pixel ratio at 2 and release the context when Home is left (journey: frame count holds at rest; context lost after leaving Home).
- [x] 1.3 Fall back to Quiet glass without WebGL 2 and after a lost context, and draw again when it is restored (journey: opaque surfaces, a light switched off and on in each state).
- [x] 1.4 Keep panel and heading text at 4.5:1 with the automatic veil (journey: measured contrast for a dark and a bright artwork in light and dark).

## 2. Home and documentation

- [x] 2.1 Mount the layer on Home with fusion, mark panels and veils, frost the rail and phone bar, and add the skin tokens (`style.test.ts`, Home layout, shapes and paging journeys).
- [x] 2.2 Document the layer and its options in the dashboard README and the check in the development guides.
