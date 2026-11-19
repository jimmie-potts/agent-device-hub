# Home, Clear: design reference

This is the prototype the owner accepted on November 18, 2026, for
[the Clear Home epic](https://github.com/jimmie-potts/agent-device-hub/issues/1927):
the presented artwork fills Home unblurred, and the Home cards sit on flat,
transparent liquid glass that fuses when panels meet, unfolds in place like
spilled mercury and is lit by the lights that are on. The owner accepted the
movement as it is. The epic owns the delivery scope and its stories own the
behavior. This reference changes no release gate.

It is a frozen reference. Do not edit the page to track the implementation; if
the accepted look changes, the owner replaces the reference.

## Open the preview

Open [home-clear-preview.html](home-clear-preview.html) in a current Chromium,
Safari or Firefox from a local checkout or download. GitHub's file page shows
source, not a running page. The page is one self-contained file: no network
request, model request, Hub connection or device operation. It needs WebGL 2;
without it the page falls back to CSS glass and says so.

Things to try, because the stills cannot show them:

- Open the light "Wall" with its arrow. Watch its edge and its neighbors while
  it grows, then close it with the arrow or Escape.
- Drag "Pendant" slowly by its handle toward "Wall". The two panels lean,
  bridge and fuse. Drop it on "Wall" to make a group; use All off, All on and
  Ungroup. Do the same with the two plugs, and with a light and a plug.
- Drag a ring up and down to dim, and press it to switch. Switch a plug.
- Change the hub mode and watch the switch's thumb stretch as it travels.
- The "Auto" button at the bottom of the rail switches light and dark.

## What is sample

Every device, name, state and number is invented, and every control changes
only the page's own memory. The picture is a drawn stand-in for the presented
artwork. Links show a note instead of leaving the page. The rail is a static
copy of the dashboard's rail.

## What each story takes from it

| Story | Take from the page |
| --- | --- |
| [#1928](https://github.com/jimmie-potts/agent-device-hub/issues/1928) backdrop source | Nothing visual. The page draws its stand-in picture where the product draws the presented artwork. |
| [#1929](https://github.com/jimmie-potts/agent-device-hub/issues/1929) glass layer | The unblurred backdrop behind the rail and the page, the flat transparent panels, the thin bevel, the soft shadow, the lip of light past a panel's lower right edge, neighbors leaning together, the veil that keeps text readable in light and dark. |
| [#1930](https://github.com/jimmie-potts/agent-device-hub/issues/1930) hero | The small "Hub mode" label, the large mode word, the three-way switch with the stretching glass thumb, the row of chips. |
| [#1931](https://github.com/jimmie-potts/agent-device-hub/issues/1931) light and plug panels | The ring dial and its name and state lines, the plug panel, and the light: a glow through the lit panel, a spill on the wall that thins with distance, neighbors' bevels catching it. |
| [#1932](https://github.com/jimmie-potts/agent-device-hub/issues/1932) unfold | The open panel's size and contents, and the motion: corners round off, the edge wobbles, the join to neighbors widens, a small overshoot, rest. |
| [#1933](https://github.com/jimmie-potts/agent-device-hub/issues/1933) fuse | The handle, the dragged panel following the pointer, the target lighting up, the fuse, and the group panel with its members, All on or All off, and Ungroup. Lights and plugs both group. |

## What to ignore

- The faces of Soundbar, the display stack, the two companions and Vacuum.
  [#1934](https://github.com/jimmie-potts/agent-device-hub/issues/1934) is
  deferred; until then those cards keep their current compact faces on the
  glass.
- The floating bar at the bottom center with "Clear" and a replay button. It
  is the prototype's own switcher.
- Styles and script for other looks that were tried and not chosen (rain,
  snow, dye, liquid metal, free-floating drops, an SVG refraction filter).
  They are still in the file and are never reached: the page builds only
  `stage7({flat: true, sharp: true})`.
- The page's code structure. It is one script that rebuilds the page from a
  state object. Read it for the look and the numbers, not as a design for the
  dashboard's code. The product reads boxes and state from the real cards and
  takes its colors from skin tokens.
- The noise picture in a `data:` URL and the picture loaded from a `data:`
  URL. The dashboard's Content Security Policy forbids both; the product
  draws the art module's decoded image and makes noise in the shader.

## The numbers

These live in the page's fragment shader (`FRAG`) and frame function
(`glFrame`), and they are what "as it is" means. Lengths are CSS pixels.

| What | Value in the page |
| --- | --- |
| Panel corner radius | 34 |
| Bevel width | 12 (`30 * 0.4`), 16 while pressed |
| How far the bevel bends the view | up to 10 (`34 * 0.3`), red and blue split by ±20% |
| Blur inside a panel | level 1.1 of the picture's mip chain; the backdrop itself is sharp |
| Veil over the backdrop | dark: 13% of `#070b14`, rising with scroll; light: 58% of `#f4f6fb` |
| Glass tone | dark: the view at 86% brightness; light: the view mixed 62% toward white |
| Shadow | the shape shifted 12 down, soft over about 44, at most 38% |
| Lip of light past the far edge | within 20 of the edge, strongest facing away from the light at upper left |
| Join between panels | smooth minimum with `k = 20`; panels rest 18 apart, so they lean without touching |
| Liquid state | `wob` from 0 to 1, driven by how fast a panel's box changes (9 per frame is full) |
| Wobble | edge displaced by noise, up to 34 at full `wob`; corners round toward a capsule by 60%; the join widens to `k * 2.3` |
| Settling | `wob` decays by `exp(-3.4 * seconds)`, so about one second |
| Move and resize timing | 720 ms, easing `linear(0, .3 7%, .68 18%, .96 31%, 1.05 43%, 1.02 57%, .994 74%, 1)` |
| New panel | fades in from 84% scale over 380 ms |
| Mode thumb | two capsules joined with `k = 16`; one follows at 30% per frame, one at 12% |
| First appearance | 700 ms; the bevel starts 2.6 times stronger and relaxes |
| Light through its own glass | the panel takes up to half its color from the light, brightest near the lamp |
| Light on the wall | `2 / (1 + d² / 8000)` from the lamp; halved where another panel is in the way |
| Light on neighbors | their bevels facing the lamp, `1 / (1 + d² / 16000)` |
| Pressed panel | 0.08 brighter, a wider and stronger bevel |
| Drawing | only when something changed; pixel ratio capped at 2 |

## Pictures

Stills from this page, for a quick look without opening it:

- [home-clear-desktop-dark.jpg](home-clear-desktop-dark.jpg): 1440 by 900, dark.
- [home-clear-desktop-light.jpg](home-clear-desktop-light.jpg): 1440 by 900, light.
- [home-clear-phone-open.jpg](home-clear-phone-open.jpg): 390 by 844, dark, with "Wall" open.
- [home-clear-spill.jpg](home-clear-spill.jpg): "Wall" a fifth of a second into unfolding.
- [home-clear-fuse.jpg](home-clear-fuse.jpg): one plug dragged toward the other.

They show state and layout. The motion is only in the page.
