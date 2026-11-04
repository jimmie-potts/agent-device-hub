## Why

The owner wants to inspect the Volcano's observed state and recorded use in B.U.N.N.Y., and to tune the session threshold from collected data, without anything implying consumption or an exact history from incomplete evidence ([Hub #616](https://github.com/jimmie-potts/agent-device-hub/issues/616)).

## What Changes

- A reusable read-only `modules/volcano` card with tabs Now, Timeline, Sessions, Totals and Gaps, placed through the Home editor and shown in the Devices directory. The module declares no page.
- The threshold control and regroup preview on the Gaps tab. The save goes through the existing tracked `volcano-session-gap/2.0` command.

Installation and physical acceptance stay with #617.

## Capabilities

### Modified Capabilities

- `volcano-history`: adds the card's behavior over the existing reads and command. No read, command or stored fact changes.

## Impact

`modules/volcano/src/frontend`, the runtime dashboard's device placement and Home catalog, the shared card chrome and the App verification browser suite. No new message format, no contract change and no new dependency.
