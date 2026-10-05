#include "usb_recovery.h"

namespace agentctl
{

bool UsbRecovery::Update(uint32_t now, bool configured, bool addressed)
{
    if(configured)
    {
        waiting_            = false;
        retrying_           = false;
        addressed_restarts_ = 0;
        return false;
    }
    if(!waiting_ || addressed != addressed_)
    {
        // A new episode: an unaddressed one gets the 3 s settle again.
        waiting_   = true;
        addressed_ = addressed;
        since_     = now;
        retrying_  = false;
        return false;
    }
    uint32_t wait;
    if(addressed_)
    {
        const uint32_t level = addressed_restarts_ < 5 ? addressed_restarts_ : 5;
        wait                 = kAddressedSettleMs << level;
        if(wait > kAddressedMaxMs)
            wait = kAddressedMaxMs;
    }
    else
        wait = retrying_ ? kRetryMs : kSettleMs;
    if(now - since_ < wait)
        return false;
    if(addressed_)
        ++addressed_restarts_;
    else
        retrying_ = true;
    since_ = now;
    return true;
}

} // namespace agentctl
