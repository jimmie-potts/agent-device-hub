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
// already enumerating the device. It restarts only a device that the host has
// not even addressed (the stuck state the trial showed). A configured device,
// including one suspended under a sleeping host, is never restarted, and
// neither is one the host addressed and deliberately left unconfigured (a
// disabled device node, a failed or slow driver install, SET_CONFIGURATION 0).
// With no host attached the retries only re-attach the device, with a brief
// main-loop pause for the stack re-initialization.
#pragma once

#include <cstdint>

namespace agentctl
{

class UsbRecovery
{
  public:
    // From becoming unconfigured and unaddressed to the first restart.
    static constexpr uint32_t kSettleMs = 3000;
    // Between restarts while the device stays that way.
    static constexpr uint32_t kRetryMs = 5000;

    // Call every loop pass. `now` is in milliseconds and may wrap. `addressed`
    // means the host gave the device an address but no configuration (also
    // while suspended in that state). True when the caller should restart the
    // USB device now.
    bool Update(uint32_t now, bool configured, bool addressed);

  private:
    bool     waiting_      = false;
    uint32_t since_        = 0;
    bool     restarted_    = false;
    uint32_t last_restart_ = 0;
};

} // namespace agentctl
