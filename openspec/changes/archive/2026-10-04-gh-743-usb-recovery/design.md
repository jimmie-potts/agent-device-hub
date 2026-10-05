## Context

The controller registers a custom HID class on libDaisy's ST device stack once at boot and never restarts it. After a disconnect, the stack ends in the default or suspended state with the class deconfigured. The host then either fails the descriptor request or detects nothing until a power cycle. The trial confirmed both, on two ports. A diagnostic build showed the internal state on the panel LEDs, read from webcam frames.

## Decisions

- **Signal.** The decision uses the USB state alone: the class's configured flag, which the stack clears on a bus reset, a clear-configuration (including SET_CONFIGURATION 0) or deinitialization, together with the core's device state. A restart needs the device both unconfigured and unaddressed: state default, or suspended from default, which is the stuck state the trial showed. A device the host addressed and left unconfigured on purpose is healthy and is never restarted. That covers a disabled device node, a failed or slow driver install, and SET_CONFIGURATION 0, so they cannot cause endless re-enumeration. The charger's VIN_GD reading looked like a natural "power returned" trigger, but after an unplug it kept reporting no input power for more than 30 s while the host was already trying to enumerate the device. A first candidate gated on it never restarted.
- **Timing.** The first restart comes 3 s after the device became unconfigured and unaddressed, which covers a normal bus reset and enumeration. Retries follow every 5 s while it stays unconfigured. In the trial, the controller was back about 15 s after the unplug.
- **Sleeping host.** A host that suspends the bus leaves the device configured, so it is never restarted, which avoids waking a sleeping PC. With no host attached, the retries only toggle the device's own attachment.
- **Data lines.** A restart first reclaims the USB data lines from the charger, ends any pending lend and starts the same 5 s quiet window as the other take-backs, then re-initializes.
- **Unverified on the device.** Host sleep and resume, and Windows selective suspend, were not tried. libDaisy gates the PHY clock on suspend, so a resume might fail and come back through this recovery with a new epoch rather than resuming seamlessly.

## Failure and recovery

A restart that fails to enumerate is retried every 5 s, without limit. A power cycle remains the fallback. The stale charger reading also feeds the low-battery lockout and is tracked separately.

## Acceptance examples

| Example | Evidence |
| --- | --- |
| Unconfigured: restart after 3 s, then every 5 s | `test_usb_recovery.cpp` |
| Configured or suspended: never restarted | `test_usb_recovery.cpp` |
| A configuration stops retries; a later loss settles again | `test_usb_recovery.cpp` |
| Short loss during re-enumeration needs no restart | `test_usb_recovery.cpp` |
| Addressed but unconfigured: never restarted | `test_usb_recovery.cpp` |
| Settle and retries across the clock wrap | `test_usb_recovery.cpp` |
| Unplug and replug on the owner's CHOMPI: reconnects without a power cycle | #743 trial: a local diagnostic build of the first candidate's recovery code plus panel-LED instrumentation, never published, reconnected with a new epoch about 15 s after the unplug. The stuck state it showed (default or suspended, unaddressed) is the one this rule restarts. B11 is repeated on the merged image in slot 04 |
