## Context

`gh-1658-home-card-heights` gave every Home card one 820 px height on flex-wrapped rows. The owner wants a long list size and a short half size, with two short cards stacked beside a long one. Flex rows cannot stack two items in one slot.

## Goals / Non-Goals

**Goals:** two heights with long equal to two short plus the gap; a long card beside two stacked short cards without a hole; heights declared in the widget catalog; saved order, sizes and keyboard order preserved; rows still share their width as before.

**Non-Goals:** changing narrow screens (D3); saving heights per placement; any core, contract or stored-format change.

## Decisions

- **Heights.** Short 448 px, long 912 px, gap 16 px. Measured content heights on 2026-11-10 with synthetic records at 1440 px: Hub mode 296, Wispr 446, music visualizer 484 (Standard) and 782 (Wide), Volcano 552, Music 570, sign 578, Roborock 590, Wemo 642, Tidbyt 675, MicroDuck 689, lights 717 to 736, Reachy 737, Pixoo 811. Short was raised from the 404 px that halving 820 px gives to 448 px, so Wispr fits short rather than becoming long; long follows at 912 px and still holds Pixoo. Cards from 552 to 811 px cannot fit short without clipping, so they are long.
- **Catalog.** `height` is required on every widget definition and Home card definition. Device, light, room and Music cards are long. An unavailable source renders only its name and reason, so `homeCardHeight` treats it as short. Art keeps `tall`, which removes the minimum; the music visualizer fits long and drops it.
- **Grid.** One CSS grid of 24 equal columns with the 16 px gap. `packHomeRows` takes cards in saved order while their preferred widths (Small 260 px, Standard 340 px) and gaps fit the measured width, as flex wrapping did; Wide cards take their own row. In a row with a long card, a short card goes under the first earlier lone short card in that row, preferring one of the same size; the shared column takes the wider size. A short card left alone in such a row spans both tracks. A row without a long card is one short track. `gridPlacements` converts each row's flex-like widths into whole column spans that fill the 24 columns, and numbers tracks across rows; the art row's tracks size to content.
- **Order.** Cards remain flat children of the grid in saved order, keyed by widget, so resizing never remounts a card or repeats its reads. The only visual reordering is the stacking case above.
- **Width measurement.** A layout effect and `ResizeObserver` read the grid's width and gap before paint and on resize.
- **Editing.** The edit bar sits above the content area, whose minimum is the card's standard height; reorder, resize, add and remove change the saved draft and the packing follows it.

## Risks / Trade-offs

- A lone short card beside long cards fills both tracks, so it shows at the long height; packing never pulls a later card across rows to fill it.
- Wispr fits short with 2 px to spare in the synthetic data; if its content grows, its tracks grow with the long card beside it rather than clipping.
- Width spans round to 24ths of the row, so column widths can differ from the former flex widths by up to about 50 px at 1440 px.

## Migration Plan

None. Saved layouts are read unchanged; reverting restores the single height.
