## Context

The glass layer (#1929) reads panel boxes from `data-glass-panel` marks and packs each panel into one row of a float texture. The reference page (`home-clear-preview.html`, `FRAG` with the far light model, `glFrame` and the ring markup) gives the look and the numbers.

## Decisions

- **Marks, not a new channel.** A panel's lamp is one element inside it marked `data-glass-lamp` (level), optionally `data-glass-lamp-color` (sRGB) and `data-glass-pressed`. The scene reads them with the box; Home's layout needs no change, and #1932 and #1933 can append their own fields.
- **Two texel columns.** Column 2 holds the light's linear color and eased level, column 3 the lamp position and eased press. A `uLights` count skips every light term when nothing is lit, so all off draws exactly what no lamps draw.
- **Time base.** Level and press ease with `exp(-rate * seconds)`, rates `-60 ln 0.84` and `-60 ln 0.76`, which match the reference at 60 fps; reduced motion jumps. The layer schedules frames only while easing.
- **Observed only.** The glow and the ring use current observations. LIFX bulbs report on their next read and Wemo plugs on their next poll, so when the latest power or brightness request of that kind succeeded after the last report (`requested.ts`), it shows beside the observed state; a latest request that failed or is still in flight leaves the observation in charge, since a module sets the desired value on acceptance and keeps it after a failure. Any other write, such as a brightness change or a module's paint, never makes an old power request newer (review of #1966). The dial's switch and the plug's pressed state show that newest power, and a press switches away from it. A drag or key starts from the newest brightness, an off light's stored one included, and an unchanged value is not sent.
- **Warm white is a skin token** (`--glass-lamp`), read like the other glass tokens, so no raw color is in layout code; LIFX colors are device data converted from hue, saturation and kelvin.
- **Light before the veil.** Panel light is added before the automatic veil so text keeps its contrast; spill is added to the backdrop before veils are measured.
- **Plugs glow too**, warm white at the reference's 0.8, since a Wemo plug here powers a lamp.

## Risks

- The light loops add a distance-field pass per lit panel per pixel; with few lights this is small, and nothing runs when none is lit.
