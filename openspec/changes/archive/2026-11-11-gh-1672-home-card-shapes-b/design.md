## Context

Stage A ([#1672](https://github.com/jimmie-potts/agent-device-hub/issues/1672), PR #1673) passes each placed card's
shape and outer size through the dashboard's `HomeShapeContext` and shows a generic face for cards that cannot use it.
Pixoo, Tidbyt and Wispr cards are module frontends mounted through `ModuleFrontend` with the SDK's `FrontendContext`,
so they had no way to read that context without importing dashboard code.

## Goals / Non-Goals

**Goals:** Pixoo, Tidbyt and Wispr draw compact content in each of the four shapes; the hint is additive and type-only;
every shape fits at 1100, 1440 and 1920 px and stays still while idle.

**Non-Goals:** Nanoleaf and Music compact content (files held by #720 work); other cards' generic faces; any change to
module commands, records, transports, Pixoo playback or the Home layout record.

## Decisions

### 1. `FrontendContext.presentation`

`{shape, width, height}`, with `shape` the contracts' `HomeShape`. `ModuleFrontend` sets it from `useHomeCardBox()`
only when the card is on the unit grid; off the grid, in one column, in the Phone arrangement and on module or device
pages it is absent. It carries no source, command or permission. A module that ignores it renders its full card, which
Art (also a module card on the grid) continues to do.

### 2. Compact content per card

| Card | Small square | Wide | Tall | Large square |
| --- | --- | --- | --- | --- |
| Pixoo | name, state, options menu, active media, caption | media beside caption, Screen on/off, playback, result line | the same stacked | media beside caption, screen, brightness with Apply, playback, result line |
| Tidbyt | name, Read only, framed artwork, evidence line, Device details and Tidbyt page | artwork beside evidence, availability, latest acceptance and links | artwork over evidence, availability, acceptance, "Physical display unobserved." and links | as Tall, larger artwork |
| Wispr | heading, refresh, period, words and speaking minutes, footer; the seven-day line where the cell is at least 230px tall inside (1100 px) | totals beside the line | totals, line, caption and day choices | the same, wider |

Playback controls (Previous, Pause or Resume, Next) appear while a session exists, as in the full card, and use symbols
with the full card's names. The Content tab, playlists, Hub-mode exceptions and Refresh player stay one step away
through the options menu's Device details. Tidbyt's Content face and Retry records stay on its device and module pages.

### 3. Fit without measuring

The artwork takes the room the text and controls leave (`flex: 1 1 0`) and keeps its proportions inside that room:
Pixoo's canvas and SVG use `object-fit: contain`, Tidbyt's frame is drawn inside its SVG, and Wispr's line uses
`preserveAspectRatio="none"` with non-scaling strokes and round dots. Wispr's one-unit line is shown by a CSS container
query on the card's own box. No script measures an element.

### 4. Offered shapes and fallback

`homeCardShapes` offers all four shapes for device cards owned by `bunny/modules/pixoo` or `bunny/modules/tidbyt` and
for the Wispr widget, with Standard still Small square. `homeCatalog` marks `fallback` when `main.tsx` would not mount
the module card (the Pixoo module does not serve `pixoo-display`, the Tidbyt module has no running display page, or
Wispr is unavailable); such a card shows the generic face in one unit and `withShapes` keeps its stored shape. A saved
card whose source is unavailable also keeps its stored shape.

## Risks / Trade-offs

- Conversion: a width-only Pixoo or Tidbyt placement saved Wide now shows as Large square (the stage A rule "Wide →
  Large square, else Wide"); Standard and Small still show Small square.
- Wispr on Home reads its numeric summary again on the wide grid, as it did before stage A; the generic face read
  nothing.

## Migration Plan

None: the hint is type-only and optional, and the stored layout, contracts and core are unchanged. Rolling back the
dashboard returns these cards to the generic face; stored shapes stay valid.
