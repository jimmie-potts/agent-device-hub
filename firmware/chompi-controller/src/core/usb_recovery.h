// USB recovery: when the controller restarts its USB device.
//
// The ST device stack does not recover by itself from a disconnect: after an
// unplug and replug, or a brief drop of the data lines, the host fails the
// device descriptor (or sees nothing) until a power cycle (#743 trial). The main
// loop asks this class on every pass and restarts the USB device (detach,
// re-initialize, re-attach) when it says so.
//
// It decides from the USB state alone. The charger's input-power reading is not
// usable here: after an unplug it kept reporting no power while the host was
// already enumerating the device. A configured device, including one suspended
// under a sleeping host, is never restarted. A device the host has not
// addressed restarts after 3 s and then every 5 s; with no host attached that
// only re-attaches it, with a brief main-loop pause. A device the host
// addressed but left unconfigured may be healthy (a disabled device node, a
// failed or slow driver install, SET_CONFIGURATION 0) or stuck mid-enumeration,
// so it waits 10 s and backs off, doubling up to 320 s between restarts.
#pragma once

#include <cstdint>

namespace agentctl
{

class UsbRecovery
{
  public:
    // Unaddressed: from becoming unconfigured to the first restart, then between restarts.
    static constexpr uint32_t kSettleMs = 3000;
    static constexpr uint32_t kRetryMs  = 5000;
    // Addressed but unconfigured: the first wait, doubling per restart up to the cap.
    static constexpr uint32_t kAddressedSettleMs = 10000;
    static constexpr uint32_t kAddressedMaxMs    = 320000;

    // Call every loop pass. `now` is in milliseconds and may wrap. `addressed`
    // means the host gave the device an address but no configuration (also
    // while suspended in that state). True when the caller should restart the
    // USB device now.
    bool Update(uint32_t now, bool configured, bool addressed);

  private:
    bool     waiting_            = false;
    bool     addressed_          = false; // the state `since_` counts for
    uint32_t since_              = 0;     // start of the current wait
    bool     retrying_           = false; // an unaddressed restart already happened
    uint32_t addressed_restarts_ = 0;     // back-off level, reset by a configuration
};

} // namespace agentctl
