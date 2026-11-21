## ADDED Requirements

### Requirement: A drop target lights up on the glass

While a Home card is dragged by its handle, the glass layer SHALL draw the dragged card's glass at its moved box, joining it to the panels it nears as neighbors join, and SHALL light up the card it would group with, as a pressed panel lights up. The target's light SHALL ease in and out over 160 ms on a time base, the layer SHALL draw no frame once it settles, and without WebGL 2 the target SHALL show an outline instead.

#### Scenario: Drag over a light
- **WHEN** the operator drags a plug by its handle over a light
- **THEN** the plug's glass follows the pointer and fuses with the light's as they meet, the light's panel lights up, and after the drop the layer settles and draws no frame
