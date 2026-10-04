// Light rendering: protocol LED index to chain position, brightness, caps and
// wire byte order.
//
// The chain layout, colour orders and caps come from the CHOMPI firmware
// (temp_led_stuff.h and TestPage.h led_map in CHOMPI-Club/CHOMPI, MIT):
// 25 key LEDs on the SMT chain in GRB order capped at 1/4, and 10 panel LEDs
// on the PTH chain in RGB order capped at 1/11.
#pragma once

#include <cstddef>
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

// WS2812 pulse encoding. Each colour bit is one timer PWM period whose high
// time encodes the bit (tuned for CHOMPI Rev2: 0.68 us one, 0.334 us zero in
// a 1.2 us period). Each chain has kPorchLeds LED-times of idle line before
// and after the data: duty 0, so no pulses, as in the upstream launcher's
// populate_off. A WS2812 counts zero-bit pulses as data, so a porch of zero
// bits would shift every colour kPorchLeds LEDs down the chain.
constexpr int      kPorchLeds = 6;
constexpr uint32_t kPulseOne  = 20; // timer ticks
constexpr uint32_t kPulseZero = 10; // timer ticks

constexpr size_t ChainPulseCount(int led_count)
{
    return static_cast<size_t>(led_count + 2 * kPorchLeds) * 24;
}

// Writes ChainPulseCount(count) PWM durations for one chain: the leading
// porch, each LED's three wire-order bytes MSB first, then the trailing porch.
void EncodeChain(const uint8_t (*leds)[3], int count, uint32_t* out);

LedLocation LocateLed(uint8_t index);

// Applies the host brightness percent (0-100), then the chain cap.
uint8_t ScaleChannel(uint8_t value, uint8_t brightness_percent, bool panel);

void RenderFrame(const Rgb leds[kLedCount], uint8_t brightness_percent,
                 ChainFrame* out);

void RenderDisconnected(uint32_t now_ms, ChainFrame* out);

} // namespace agentctl
