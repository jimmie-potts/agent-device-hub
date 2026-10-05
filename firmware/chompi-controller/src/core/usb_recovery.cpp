#include "usb_recovery.h"

namespace agentctl
{

bool UsbRecovery::Update(uint32_t now, bool configured, bool addressed)
{
    if(configured || addressed)
    {
        waiting_   = false;
        restarted_ = false;
        return false;
    }
    if(!waiting_)
    {
        waiting_ = true;
        since_   = now;
        return false;
    }
    const uint32_t from = restarted_ ? last_restart_ : since_;
    const uint32_t wait = restarted_ ? kRetryMs : kSettleMs;
    if(now - from < wait)
        return false;
    restarted_    = true;
    last_restart_ = now;
    return true;
}

} // namespace agentctl
