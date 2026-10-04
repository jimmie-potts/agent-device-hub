#include "controller.h"

#include <cstring>

namespace agentctl
{
namespace
{
uint64_t Bit(uint8_t control) { return uint64_t{1} << (control - 1); }
} // namespace

Controller::Controller() { Reset(); }

void Controller::Reset()
{
    configured_ = false;
    epoch_      = 0;
    ResetSession();
    brightness_percent_ = 100;
    profile_version_    = 0;
}

void Controller::ResetSession()
{
    next_seq_          = 1;
    host_alive_        = false;
    have_host_beat_    = false;
    last_host_beat_    = 0;
    last_device_beat_  = 0;
    hello_pending_     = false;
    heartbeat_pending_ = false;
    queue_.Clear();
    reported_down_      = 0;
    suppressed_         = 0;
    last_applied_frame_ = 0;
    ClearLights();
}

void Controller::ClearLights()
{
    std::memset(applied_, 0, sizeof(applied_));
    part_present_[0] = part_present_[1] = false;
}

void Controller::OnUsbConfigured(uint16_t epoch, uint32_t now)
{
    ResetSession();
    configured_       = true;
    epoch_            = epoch == 0 ? 1 : epoch; // 0 is never a valid epoch
    last_device_beat_ = now;
    // hello waits for the first host heartbeat: Windows drops reports sent
    // while no handle is open.
}

void Controller::OnUsbDeconfigured()
{
    configured_ = false;
    ResetSession();
}

Reason Controller::OnHostReport(const uint8_t* data, size_t length,
                                uint32_t now)
{
    Message      msg{};
    const Reason reason = Decode(data, length, &msg);
    if(reason != Reason::Ok)
        return reason;

    switch(msg.type)
    {
        case MessageType::HostHeartbeat:
            have_host_beat_     = true;
            last_host_beat_     = now;
            brightness_percent_ = msg.host_heartbeat.brightness_percent;
            profile_version_    = msg.host_heartbeat.profile_version;
            return Reason::Ok;
        case MessageType::Leds: HandleLeds(msg.leds); return Reason::Ok;
        default:
            // Device-to-host messages are not valid in this direction.
            return Reason::UnknownType;
    }
}

void Controller::HandleLeds(const LedsMsg& msg)
{
    const uint8_t part   = msg.part;
    const uint8_t other  = part == 0 ? 1 : 0;
    part_present_[part]  = true;
    part_frame_[part]    = msg.frame;
    std::memcpy(part_colors_[part], msg.colors, msg.count * sizeof(Rgb));

    if(!part_present_[other] || part_frame_[other] != msg.frame)
        return;

    // Both halves of one frame: apply them together.
    std::memcpy(applied_, part_colors_[0], kLedsPart0Count * sizeof(Rgb));
    std::memcpy(applied_ + kLedsPart0Count, part_colors_[1],
                kLedsPart1Count * sizeof(Rgb));
    last_applied_frame_ = msg.frame;
    part_present_[0] = part_present_[1] = false;
}

void Controller::OnInput(const InputEvent& event)
{
    if(!connected())
        return; // never queued while no host is connected

    if(event.kind == InputKind::Turn)
    {
        if(!queue_.MergeTurnIntoTail(event.control, event.delta))
            Enqueue(event.control, event.kind, event.delta);
        return;
    }

    if(!IsButtonControl(event.control))
        return;
    const uint64_t bit = Bit(event.control);
    if(suppressed_ & bit)
    {
        // Held since before this host arrived: its release ends the hold
        // without reporting anything.
        if(event.kind == InputKind::Release)
            suppressed_ &= ~bit;
        return;
    }
    Enqueue(event.control, event.kind, 0);
}

void Controller::Enqueue(uint8_t control, InputKind kind, int8_t delta)
{
    queue_.Push(QueuedInput{next_seq_, control, kind, delta});
    next_seq_ = next_seq_ == 0xFFFF ? 1 : static_cast<uint16_t>(next_seq_ + 1);
}

void Controller::HostLost()
{
    host_alive_    = false;
    queue_.Clear(); // nothing waiting is ever replayed
    reported_down_ = 0;
    suppressed_    = 0;
    // A stale frame never comes back, and heartbeats report frame 0 until the
    // host applies a new one, so the bridge knows to resend.
    ClearLights();
    last_applied_frame_ = 0;
}

void Controller::HostFound(uint64_t down_mask)
{
    host_alive_    = true;
    queue_.Clear();
    reported_down_ = 0;
    suppressed_    = down_mask;
    // Lights stay as they are: HostLost() and a new enumeration already
    // cleared them, and a frame sent just before the first heartbeat counts.
    // A host session starts: hello goes out before any input.
    hello_pending_ = true;
}

void Controller::Update(uint32_t now, uint64_t down_mask)
{
    if(!configured_)
        return;

    const bool alive
        = have_host_beat_ && (now - last_host_beat_) < kHostTimeoutMs;
    if(host_alive_ && !alive)
        HostLost();
    else if(!host_alive_ && alive)
        HostFound(down_mask);

    if(now - last_device_beat_ >= kHeartbeatIntervalMs)
    {
        last_device_beat_  = now;
        heartbeat_pending_ = true;
    }

    if(!host_alive_)
        return;

    // A release lost to overflow is resent once its key is physically up and
    // nothing for that key is still waiting.
    for(uint8_t control = 1; control <= kControlCount; ++control)
    {
        const uint64_t bit = Bit(control);
        if((reported_down_ & bit) && !(down_mask & bit)
           && !queue_.ContainsControl(control))
            Enqueue(control, InputKind::Release, 0);
    }
}

bool Controller::NextReport(uint8_t out[kReportSize])
{
    if(!configured_)
        return false;

    if(hello_pending_)
    {
        hello_pending_ = false;
        EncodeHello(MakeHello(epoch_), out);
        return true;
    }
    if(heartbeat_pending_)
    {
        heartbeat_pending_ = false;
        EncodeHeartbeat(HeartbeatMsg{epoch_, last_applied_frame_, host_alive_},
                        out);
        return true;
    }

    QueuedInput event{};
    if(!host_alive_ || !queue_.Pop(&event))
        return false;

    if(event.kind == InputKind::Press && IsButtonControl(event.control))
        reported_down_ |= Bit(event.control);
    else if(event.kind == InputKind::Release && IsButtonControl(event.control))
        reported_down_ &= ~Bit(event.control);

    EncodeInput(InputMsg{epoch_, event.sequence, event.control, event.kind,
                         event.delta},
                out);
    return true;
}

void Controller::Render(uint32_t now, ChainFrame* out) const
{
    if(connected())
        RenderFrame(applied_, brightness_percent_, out);
    else
        RenderDisconnected(now, out);
}

} // namespace agentctl
