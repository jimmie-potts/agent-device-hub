// Connection session: epoch, sequence numbers, host liveness, the input queue,
// light frames and the order reports leave the device.
//
// The board layer calls, once per main-loop pass:
//   OnHostReport() for each received output report,
//   OnInput() for each scanner event,
//   Update() with the scanner's down mask,
//   NextReport() whenever the IN endpoint is free.
#pragma once

#include <cstddef>
#include <cstdint>

#include "event_queue.h"
#include "input.h"
#include "leds.h"
#include "protocol.h"

namespace agentctl
{

class Controller
{
  public:
    static constexpr uint32_t kHeartbeatIntervalMs = 500;
    static constexpr uint32_t kHostTimeoutMs       = 2000;

    Controller();

    // Power-on state: not enumerated, no host.
    void Reset();

    // A USB enumeration finished (SET_CONFIGURATION). Starts a new epoch:
    // sequence restarts at 1, queue and light state clear.
    //
    // A host session starts on the first valid host heartbeat after an
    // enumeration or after a 2 s host timeout. hello (with the current epoch)
    // is then sent before any input. A timeout clears the queue, forgets
    // reported keys, turns the lights off and resets the reported light frame
    // to 0; the epoch stays until the next enumeration.
    void OnUsbConfigured(uint16_t epoch, uint32_t now);
    // The configuration went away (bus reset, unplug, deconfigure).
    void OnUsbDeconfigured();

    // Handles one output report from the host. Invalid reports, and valid
    // device-to-host messages, are dropped without any action.
    Reason OnHostReport(const uint8_t* data, size_t length, uint32_t now);

    // Handles one scanner event. Dropped unless a host is connected.
    void OnInput(const InputEvent& event);

    // Advances timers and liveness. `down_mask` is InputScanner::DownMask().
    void Update(uint32_t now, uint64_t down_mask);

    // Writes the next report to send, if any. Priority: hello, heartbeat,
    // queued input. Input is only sent after this session's hello.
    bool NextReport(uint8_t out[kReportSize]);

    // What the LEDs should show right now.
    void Render(uint32_t now, ChainFrame* out) const;

    bool     configured() const { return configured_; }
    bool     host_alive() const { return host_alive_; }
    // Configured and the host heartbeat is current.
    bool     connected() const { return configured_ && host_alive_; }
    uint16_t epoch() const { return epoch_; }
    uint16_t last_applied_frame() const { return last_applied_frame_; }
    uint8_t  brightness_percent() const { return brightness_percent_; }
    uint32_t profile_version() const { return profile_version_; }
    const Rgb* applied_leds() const { return applied_; }
    size_t   queued() const { return queue_.Size(); }
    uint32_t dropped() const { return queue_.dropped(); }

  private:
    void ResetSession();
    void ClearLights();
    void Enqueue(uint8_t control, InputKind kind, int8_t delta);
    void HostLost();
    void HostFound(uint64_t down_mask);
    void HandleLeds(const LedsMsg& msg);

    bool     configured_ = false;
    uint16_t epoch_      = 0;
    uint16_t next_seq_   = 1;

    bool     host_alive_      = false;
    bool     have_host_beat_  = false;
    uint32_t last_host_beat_  = 0;
    uint32_t last_device_beat_ = 0;
    bool     hello_pending_     = false;
    bool     heartbeat_pending_ = false;

    EventQueue queue_;
    uint64_t   reported_down_ = 0; // presses sent without a release yet
    uint64_t   suppressed_    = 0; // held when the host arrived

    Rgb      applied_[kLedCount];
    uint16_t last_applied_frame_ = 0;
    bool     part_present_[2]    = {false, false};
    uint16_t part_frame_[2]      = {0, 0};
    Rgb      part_colors_[2][kMaxLedsPerPart];

    uint8_t  brightness_percent_ = 100;
    uint32_t profile_version_    = 0;
};

} // namespace agentctl
