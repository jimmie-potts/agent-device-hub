## Why

[Hub #330](https://github.com/jimmie-potts/agent-device-hub/issues/330) records what the owner saw during #289's installed check on 2026-09-25:

- A LIFX bulb that was off showed "On" in B.U.N.N.Y.'s Power control. Power was unknown, and the control's placeholder was an unlabeled "On", so turning the bulb on took an Off and then an On.
- The Tidbyt page, and the unqualified `beam` bulb's, shows four disabled general-control forms whose buttons look clickable.

The owner asked for the bulb's real power on page load, a single line for devices without controls, and clearly disabled buttons.

## What Changes

- The local controller host reads a qualified LIFX bulb on demand. When its snapshot is read and it has no observation, or the observation is 30 s old or more, the host queues one read-only LightGet through the bulb's queue. It does this at most once per bulb every 30 s and only while something reads, and it never reads an unqualified bulb. This relaxes #289's "never reads on its own"; it still never writes or paints on its own.
- B.U.N.N.Y.'s Power control starts from desired power when known, otherwise from observed power, and otherwise from no selection with an explicit unknown hint. Its hint shows the last reading and its age.
- A component whose snapshot declares no power, brightness, media or scenes shows one line naming that, instead of four disabled forms. A LIFX bulb that declares neither color nor temperature does the same for Lighting.
- Disabled buttons get a distinct style from new skin tokens instead of half opacity.
- The hub is bumped to 0.3.7 because the bundled dashboard changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-controller-host`: the one-writer requirement allows bounded, read-only, on-demand bulb reads.
- `unified-dashboard`: the Power starting value, the no-controls line and distinct disabled buttons.

## Impact

Changes `apps/local-controllers/src/host.ts` and its tests, and `apps/dashboard/src/main.tsx`, `client.ts`, `style.css`, the skin file and their tests, with matching README and development notes. The hub version is bumped. No contract, hub route or LIFX package change. Installation is separate and needs the owner's request.
