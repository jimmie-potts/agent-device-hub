## Why

The [#743](https://github.com/jimmie-potts/agent-device-hub/issues/743) owner trial found that the controller firmware from [#741](https://github.com/jimmie-potts/agent-device-hub/issues/741) never recovers its USB connection.
- An unattended drop at 16:07 left Windows failing the device descriptor.
- An unplug and replug left Windows seeing nothing at all.
- In both cases only a power cycle brought the controller back.

The stock TEMPO firmware recovers from the same unplug and replug, so the defect is in this firmware. It broke trial step B11 (reconnect).

## What Changes

- Add a host-tested `UsbRecovery` decision in `firmware/chompi-controller/src/core/`. The main loop restarts the USB device once the device has been unconfigured for 3 s, and retries every 5 s. A restart takes the data lines back from the charger, re-initializes the stack and re-attaches.
- Document the behavior in the firmware README and add a "USB reconnection without a power cycle" requirement to `chompi-controller-firmware`.

## Capabilities

### Modified Capabilities

- `chompi-controller-firmware`: USB reconnection without a power cycle.

## Impact

Firmware only. The protocol, the bridge and the Hub are unchanged. A reconnect is a new enumeration and therefore a new epoch, which the bridge already handles. The new image goes into the card's slot 04 over USB storage under the epic's card authority.
