# Devices navigation design reference

[Issue #1950](https://github.com/jimmie-potts/agent-device-hub/issues/1950) owns
the implementation and acceptance criteria. This is the selected device-only
prototype with sample device names and the variant picker removed. It uses
sample data and runs locally without a Hub connection.

Open [index.html](index.html) in Chrome or Edge for the desktop layout. Open
[phone.html](phone.html) beside it for the interactive phone layout. The
Devices popout starts open in both. Select a brand to expand it, then open a
light or choose **All devices** to see the same grouping in the directory.
Open Pixoo and Tidbyt to inspect their page structure.

## Decisions after the prototype

- **Companions** takes Habitat's rail slot. The Companions overview links to
  Habitat, profiles, Preferences, and Companion knowledge. Keep
  `#/habitat` and the existing companion addresses, and keep **Conversations**
  in the rail. The demo still shows the earlier rail and companion placements.
- Use the demo for Devices layout and interaction. Use the shared Clear
  material and Quiet glass fallback for the implemented dashboard. The Clear
  reference defines the material, and #1929 owns the shared rendering work.
  [Clear epic #1927](https://github.com/jimmie-potts/agent-device-hub/issues/1927) ·
  [Design reference](https://github.com/jimmie-potts/agent-device-hub/tree/main/docs/design-references/home-clear) ·
  [Glass layer #1929](https://github.com/jimmie-potts/agent-device-hub/issues/1929)
- The runtime supplies actual light labels, availability, and controls. The
  demo's four LIFX names are examples. Use existing routes, commands, and
  evidence in production.
