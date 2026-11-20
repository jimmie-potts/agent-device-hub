## Why

The owner accepted the Clear Home prototype (epic [#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927), reference `docs/design-references/home-clear/`). Story [#1931](https://github.com/jimmie-potts/agent-device-hub/issues/1931) gives a light in one unit the reference's ring dial, a plug a press panel, and lets the lights that are on light the room on the glass layer from [#1929](https://github.com/jimmie-potts/agent-device-hub/issues/1929). Owner decision 8: a LIFX light uses its observed color and a light whose module reports no color (Nanoleaf today) glows warm white.

## What Changes

- A light, room or group card with lights in the Small square shape becomes a ring dial: drag to dim, press to switch, a slider and a switch for the keyboard. It sends the existing guarded power and brightness commands; the ring and the glow follow observed state and a request shows beside it until the light reports it.
- A Wemo plug in the Small square shape becomes a press panel that switches it with the existing command; Open leads to its page.
- The glass layer takes each lit panel's color, level, lamp position and press from marks on the page, eases them on a time base, and draws the light through the panel, on the backdrop and on facing bevels. With every light off nothing is drawn.
- Other shapes keep their faces; without WebGL 2 the dial and the panel work in plain CSS.

## Capabilities

### Modified Capabilities

- `home-layout`: the Small square light and plug faces.
- `runtime-lighting`: the ring dial.
- `runtime-dashboard`: the plug press panel and the lit room on Home's glass.

## Impact

`apps/runtime/dashboard/src` (light card, Wemo device card, Home catalog shapes, glass scene, renderer, shader and layer, skin tokens) and the lighting, Wemo and glass browser journeys. No command, sync family, route, stored field or content request is added; the Content Security Policy is unchanged. Installation is tracked in [#1935](https://github.com/jimmie-potts/agent-device-hub/issues/1935).
