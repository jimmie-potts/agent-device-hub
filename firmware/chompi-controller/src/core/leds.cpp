#include "leds.h"

#include <cstring>

namespace agentctl
{

LedLocation LocateLed(uint8_t index)
{
    if(index < 15) // keys 1-15, right to left on the key chain
        return LedLocation{false, static_cast<uint8_t>(24 - index)};
    if(index < kKeyLedCount) // keys 16-25, left to right
        return LedLocation{false, static_cast<uint8_t>(index - 15)};
    // Panel LEDs keep protocol order: CHOMPI key, ENC_4, ENC_1, ENC_2, ENC_3,
    // two wheel LEDs, Play, Loop, volume.
    return LedLocation{true, static_cast<uint8_t>(index - kKeyLedCount)};
}

uint8_t ScaleChannel(uint8_t value, uint8_t brightness_percent, bool panel)
{
    const unsigned percent = brightness_percent > 100 ? 100 : brightness_percent;
    const unsigned scaled  = static_cast<unsigned>(value) * percent / 100;
    return static_cast<uint8_t>(scaled / (panel ? kPanelCapDivisor : kKeyCapDivisor));
}

void RenderFrame(const Rgb leds[kLedCount], uint8_t brightness_percent,
                 ChainFrame* out)
{
    std::memset(out, 0, sizeof(*out));
    for(uint8_t i = 0; i < kLedCount; ++i)
    {
        const LedLocation loc = LocateLed(i);
        const uint8_t     r   = ScaleChannel(leds[i].r, brightness_percent, loc.panel);
        const uint8_t     g   = ScaleChannel(leds[i].g, brightness_percent, loc.panel);
        const uint8_t     b   = ScaleChannel(leds[i].b, brightness_percent, loc.panel);
        if(loc.panel)
        {
            out->panel[loc.position][0] = r;
            out->panel[loc.position][1] = g;
            out->panel[loc.position][2] = b;
        }
        else
        {
            out->keys[loc.position][0] = g;
            out->keys[loc.position][1] = r;
            out->keys[loc.position][2] = b;
        }
    }
}

void RenderDisconnected(uint32_t now_ms, ChainFrame* out)
{
    const uint32_t half  = kDisconnectedPeriodMs / 2;
    const uint32_t phase = now_ms % kDisconnectedPeriodMs;
    const uint32_t tri   = phase < half ? phase : kDisconnectedPeriodMs - phase;
    const uint8_t  level = static_cast<uint8_t>(
        kDisconnectedMinLevel
        + tri * (kDisconnectedMaxLevel - kDisconnectedMinLevel) / half);

    Rgb leds[kLedCount];
    std::memset(leds, 0, sizeof(leds));
    leds[kChompiKeyLed] = Rgb{level, level, level};
    RenderFrame(leds, 100, out);
}

} // namespace agentctl
