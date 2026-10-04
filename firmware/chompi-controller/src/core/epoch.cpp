#include "epoch.h"

namespace agentctl
{

uint16_t NextEpoch(uint16_t previous, uint32_t random)
{
    const uint16_t low  = static_cast<uint16_t>(random);
    const uint16_t high = static_cast<uint16_t>(random >> 16);
    if(low != 0 && low != previous)
        return low;
    if(high != 0 && high != previous)
        return high;
    const uint16_t next = static_cast<uint16_t>(previous + 1);
    return next == 0 ? 1 : next;
}

} // namespace agentctl
