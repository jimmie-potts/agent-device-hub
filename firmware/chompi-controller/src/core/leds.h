// Light rendering: protocol LED index to chain position, brightness, caps and
// wire byte order.
//
// The chain layout, colour orders and caps come from the CHOMPI firmware
// (temp_led_stuff.h and TestPage.h led_map in CHOMPI-Club/CHOMPI, MIT):
// 25 key LEDs on the SMT chain in GRB order capped at 1/4, and 10 panel LEDs
// on the PTH chain in RGB order capped at 1/11.
#pragma once

#include <cstdint>

#include "protocol.h"

namespace agentctl
{

constexpr uint8_t kKeyLedCount   = 25; // SMT chain
constexpr uint8_t kPanelLedCount = 10; // PTH chain

constexpr uint8_t kKeyCapDivisor   = 4;  // about 25%
constexpr uint8_t kPanelCapDivisor = 11; // about 9%

constexpr uint8_t kChompiKeyLed = 25; // protocol LED index

// Disconnected pattern: a slow white breathe on the CHOMPI key LED only.
constexpr uint32_t kDisconnectedPeriodMs = 4000;
constexpr uint8_t  kDisconnectedMinLevel = 16;  // before the panel cap
constexpr uint8_t  kDisconnectedMaxLevel = 128; // before the panel cap

struct LedLocation
{
    bool    panel;    // true: PTH chain, false: SMT chain
    uint8_t position; // index on that chain, before the porch
};

// Both chains, in chain order, each LED's three bytes in wire order
// (keys G,R,B; panel R,G,B), already brightness-scaled and capped.
struct ChainFrame
{
    uint8_t keys[kKeyLedCount][3];
    uint8_t panel[kPanelLedCount][3];
};

LedLocation LocateLed(uint8_t index);

// Applies the host brightness percent (0-100), then the chain cap.
uint8_t ScaleChannel(uint8_t value, uint8_t brightness_percent, bool panel);

void RenderFrame(const Rgb leds[kLedCount], uint8_t brightness_percent,
                 ChainFrame* out);

void RenderDisconnected(uint32_t now_ms, ChainFrame* out);

} // namespace agentctl
