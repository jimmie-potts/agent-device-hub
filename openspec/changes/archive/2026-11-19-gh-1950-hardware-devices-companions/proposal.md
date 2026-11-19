## Why

The Devices menu and directory list every module page, so companion features, music and task pages such as a display's playlists sit beside the hardware, and Pixoo and Tidbyt each take several entries. [Hub #1950](https://github.com/jimmie-potts/agent-device-hub/issues/1950) makes Devices the place to find configured hardware and gives the companion features their own rail destination, following the owner's selected device-only prototype for the layout and the Clear Home epic ([#1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927)) for the material.

## What changes

- Companions takes Habitat's place in the rail. It opens an overview that links Habitat, the companion profiles, Preferences and Companion knowledge. `#/habitat` keeps its address and selects Companions; the conversations stay in the rail.
- Audio moves under Home: Home links it and the jump palette offers it.
- The Devices menu and the directory list hardware only, in Displays, Lighting and Appliances. Nanoleaf and LIFX are disclosures over their lights and their overview; the directory lists the same lights under each brand. Devices are named by published labels, observed Nanoleaf kinds or readable IDs.
- Pixoo and Tidbyt have one entry each. Tidbyt opens its Status and Content view. Pixoo opens Display, which links Advanced playback and Device settings, beside Media (Library, Playlists) and Agent status (Monitor). Every existing address opens its view.
- The jump palette and the pins are built from every declared page and device, so pages outside the hardware inventory stay reachable.
- Pages use the shared Clear material with its Quiet glass fallback from #1929, without Home's backdrop, fusion or unfolding.

## Capabilities

### Modified capabilities

- `runtime-dashboard`: the five destinations, the Devices directory and menu, Habitat, the jump palette and the conversations' rail mark change; requirements are added for the Companions overview, the display views and device names.

## Impact

The runtime dashboard shell, its stylesheet, its unit tests and its browser journeys change. Routes, page addresses, saved pins, the module catalog, sign-in, the feed, every module's data and commands, and every command guard stay the same. The menu, the directory, the overview and the views read what the shell already holds; they navigate and send nothing.
