## Context

`themeColors` maps a bounded palette of up to eight hex colors to thirteen decorative roles in light and dark appearance. The art module orders a palette by pixel count in coarse buckets, so black and the grey buckets are common first entries and carry no hue. The Quiet glass skin separates its page background, inset, panel and raised surfaces by lightness.

## Decisions

- Colors are built in OKLCH. Each role has a fixed lightness and a chroma ceiling for each appearance, held in one table beside the function. The lightness steps follow Quiet glass, so a blue artwork's surfaces, links and action colors land close to the default skin and no artwork can collapse two surfaces into one. Card and control edges are the exception: the existing rule holds them at 3:1 against their panel under any art theme, as the old derivation did, so they stay stronger than the default skin's edges.
- The artwork supplies the hue and the tint strength only. Strength is the source color's chroma against a full-tint value, held between one half and one, so a weakly colored entry still gives a visible tint and a vivid one cannot exceed the role's ceiling.
- The tint source is the first palette entry whose chroma reaches a floor and whose lightness is above a near-black limit. Entries below the chroma floor (black, white, grey and a few near-grey shades) are skipped. Near-black entries with a hue, which the eye reads as black, come after every lighter one, so they tint only when nothing lighter has a hue. The second such entry tints the second wash; with only one, both washes share it. With none, every role is neutral at its lightness step. Dominance order is kept so the result stays predictable for a given picture.
- A color outside sRGB gives up chroma and keeps its lightness, so no role leaves its step.
- The conversion constants are the published OKLab matrices. No dependency is added; the dashboard has none for color today.
- Nothing is stored. The change from the default skin to the artwork's colors shortly after load stays, because the existing rule is that art arrival never saves a palette or a preference. Removing it is a separate owner decision.

## Risks

- Every followed or locked palette looks different after this change, because lightness no longer comes from the artwork. A palette locked before the change keeps its stored colors as data and is drawn with the new steps.
- WCAG contrast depends on hue at a fixed OKLCH lightness. The unit test checks text, focus, link, action and edge contrast for black, white, grey and six saturated hues in both appearances.
