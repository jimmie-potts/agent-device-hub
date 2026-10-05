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
// under a sleeping host, is never restarted; with no host attached the retries
// are harmless.
#pragma once

#include <cstdint>

namespace agentctl
{

class UsbRecovery
{
  public:
    // From losing (or never having) the host's configuration to the first restart.
    static constexpr uint32_t kSettleMs = 3000;
    // Between restarts while the device stays unconfigured.
    static constexpr uint32_t kRetryMs = 5000;

    // Call every loop pass. `now` is in milliseconds and may wrap. True when
    // the caller should restart the USB device now.
    bool Update(uint32_t now, bool configured);

  private:
    bool     waiting_      = false;
    uint32_t since_        = 0;
    bool     restarted_    = false;
    uint32_t last_restart_ = 0;
};

} // namespace agentctl
