// Connection epoch selection.
#pragma once

#include <cstdint>

namespace agentctl
{

// Picks a nonzero epoch that differs from `previous`, using the low half of
// `random` first, then the high half, then previous + 1.
uint16_t NextEpoch(uint16_t previous, uint32_t random);

} // namespace agentctl
