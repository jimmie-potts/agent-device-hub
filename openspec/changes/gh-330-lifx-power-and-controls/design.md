## Context

The LIFX controller's `refresh(deviceId)` queues one LightGet through the bulb's queue, updates the observation and never changes the bulb. The host has so far only issued writes that commands admit, so a bulb's power stays unknown until a command's read-modify-write reads it. The dashboard reads each component's snapshot every 5 s while it is open. The Power form's initial value falls back to `'on'` when desired power is unknown.

## Goals / Non-Goals

**Goals:** show real bulb power soon after a page opens, without background polling. Make the Power control honest when power is unknown. Remove dead forms. Make disabled buttons look disabled.

**Non-Goals:** a periodic poller, a read route or button, observed-power display beyond the Power hint, Beam qualification, and any change to Tidbyt behavior.

## Decisions

### Read on snapshot demand, bounded per bulb

The host triggers the read from the snapshot route instead of on a timer. A read happens only while a client is looking, and never with the dashboard closed. The rule is per bulb: an observation that is missing or at least 30 s old, and no read started in the last 30 s. A failed read still counts as a started read, so an unreachable bulb is tried at most every 30 s. The snapshot is answered from memory before the read settles, so a slow or offline bulb never delays the hub's 2 s client. Unqualified bulbs are skipped, which keeps #289's promise that `beam` gets no traffic.

Alternatives considered: a periodic poll (traffic with nobody watching); a startup read only (goes stale); a "read bulb" button (the owner asked for on-load).

The contract says snapshot reads cannot issue writes. A LightGet is a read. It reserves no identity and changes no revision or generation, so the snapshot stays a read.

### Power starting value

The form starts from desired power, then observed power, then an explicit empty choice. The empty option is shown only while the draft is empty, so a started draft is always On or Off and the form never sends a guessed value. This applies to every device. The Nanoleaf wall reports desired power only during an override, so its control also starts empty when power is unknown.

### No-controls line and disabled style

`GeneralControls` returns one line when none of the four capabilities is declared. The line names them, so the missing-capability explanation stays. Lighting does the same for a bulb with neither color nor temperature. Disabled buttons get `--disabled-bg`, `--disabled-text` and `--disabled-edge` skin tokens instead of half opacity, and the style test keeps every consumed token defined in the skin.

## Risks / Trade-offs

- [More bulb traffic] → At most one LightGet per bulb per 30 s, only while a snapshot is being read.
- [A read queued ahead of a command adds latency] → A LightGet takes milliseconds on the LAN, and the command still waits its turn in the same queue.
- [Tests that asserted zero traffic after reads change] → Only qualified bulbs are affected. Each changed expectation is listed in the PR.
