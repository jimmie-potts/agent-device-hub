## Context

The controller registers a custom HID class on libDaisy's ST device stack once at boot and never restarts it. After a disconnect, the stack ends in the default or suspended state with the class deconfigured. The host then either fails the descriptor request or detects nothing until a power cycle. The trial confirmed both, on two ports. A diagnostic build showed the internal state on the panel LEDs, read from webcam frames.

## Decisions

- **Signal.** The decision uses the USB state alone: the class's configured flag, which the stack clears on a bus reset, a clear-configuration (including SET_CONFIGURATION 0) or deinitialization, together with whether the host has addressed the device. Addressed means state ADDRESSED, or SUSPENDED with ADDRESSED as the previous state. The charger's VIN_GD reading looked like a natural "power returned" trigger, but after an unplug it kept reporting no input power for more than 30 s while the host was already trying to enumerate the device. A first candidate gated on it never restarted.
- **Two classes of unconfigured.** A device the host has not addressed is stuck or unattached, so it restarts quickly. A device the host addressed and left unconfigured is ambiguous. It may be healthy on purpose: a disabled device node, a failed or slow driver install, SET_CONFIGURATION 0. Or it may be stuck after SET_ADDRESS, which Windows' enumeration retries can produce before the host disables the port. Excluding it entirely could leave the stuck case without recovery. Treating it like the unaddressed class would re-enumerate a disabled device every 5 s. So it backs off. The back-off level survives the addressed/unaddressed flips each restart causes, and only a configuration resets it.
- **Timing.** Unaddressed: the first restart comes 3 s after the device became unconfigured, which covers a normal bus reset and enumeration, and retries follow every 5 s. Addressed but unconfigured: 10 s, then 20, 40, 80, 160 and 320 s, then every 320 s. In the trial, the controller was back about 15 s after the unplug.
- **Sleeping host.** A host that suspends the bus leaves the device configured, so it is never restarted, which avoids waking a sleeping PC. With no host attached, the retries only toggle the device's own attachment.
- **Data lines.** While the charger has the data lines for port detection (at most about 1.5 s), the decision waits, so a restart never cuts the detection short. A restart then takes the lines back and re-initializes. Only if a lend were still pending would it start the 5 s quiet window the other take-backs use. A routine restart starts none, so detection at the next plug-in is not suppressed.
- **Unverified on the device.** Host sleep and resume, and Windows selective suspend, were not tried. libDaisy gates the PHY clock on suspend, so a resume might fail and come back through this recovery with a new epoch rather than resuming seamlessly.

## Failure and recovery

A restart that fails to enumerate is retried every 5 s, without limit. A power cycle remains the fallback. The stale charger reading also feeds the low-battery lockout and is tracked separately.

## Acceptance examples

| Example | Evidence |
| --- | --- |
| Unconfigured: restart after 3 s, then every 5 s | `test_usb_recovery.cpp` |
| Configured or suspended: never restarted | `test_usb_recovery.cpp` |
| A configuration stops retries; a later loss settles again | `test_usb_recovery.cpp` |
| Addressed but unconfigured: 10 s, doubling to 320 s; the back-off survives re-enumeration flips and a configuration resets it | `test_usb_recovery.cpp` |
| Short loss during re-enumeration needs no restart | `test_usb_recovery.cpp` |
| Settle and retries across the clock wrap | `test_usb_recovery.cpp` |
| Unplug and replug on the owner's CHOMPI: reconnects without a power cycle | #743 trial: a local diagnostic build of the first candidate's recovery code, which restarted any unconfigured state, plus panel-LED instrumentation, never published. It reconnected with a new epoch about 15 s after the unplug. Its panel showed the state as default or suspended; the previous state was not observed. This final rule's acceptance gate is B11 on the merged image in slot 04 |
