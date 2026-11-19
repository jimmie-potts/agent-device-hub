## Why

With Artwork colors following the artwork, dark appearance turns almost pure black and the page background, cards and raised controls become one color ([Hub #1920](https://github.com/jimmie-potts/agent-device-hub/issues/1920)). The shell built every decorative color from the palette's first entry, mixed toward black or white. The art module lists a picture's most common color first, which for a dark picture is black, and the dark values were small fractions of that color, so they were close to black for nearly all artwork. The requirement asked for readable text and focus but not for surfaces that stay apart.

## What changes

- Each decorative role keeps a fixed lightness step in light and dark appearance, close to Quiet glass. The artwork supplies only the hue and how strong the tint is.
- The tint comes from the first palette color that has a hue. The next such color tints the second background wash. A palette with no such color gives neutral surfaces on the same steps.
- The requirement says that the page background, inset, panel and raised surfaces stay distinguishable for every accepted palette.

## Capabilities

### Modified capabilities

- `runtime-dashboard`: the owner-controlled art theme requirement says how surfaces are derived and adds a scenario for dark and colorless artwork.

## Impact

`apps/runtime/dashboard/src/skins/art-theme.ts`, its unit test, the dashboard guide and the style guide. The closed list of decorative roles, the fixed text, focus, semantic and device colors, the stored preference, the Settings controls, the art module's palette and every message format stay as they are. The short change from Quiet glass to the artwork's colors after a page load stays, because art arrival never saves a palette.
