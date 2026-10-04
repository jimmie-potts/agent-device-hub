// Light mapping, brightness, caps and the disconnected pattern.
#include <cstring>

#include "core/leds.h"
#include "test.h"

using namespace agentctl;

TEST("leds: protocol index to chain position")
{
    // Keys 1-15 run right to left on the key chain, keys 16-25 left to right
    // (WAVE TestPage led_map; the launcher lights key 1 at position 24).
    CHECK(!LocateLed(0).panel);
    CHECK_EQ(LocateLed(0).position, 24);
    CHECK_EQ(LocateLed(14).position, 10);
    CHECK_EQ(LocateLed(15).position, 0);
    CHECK_EQ(LocateLed(24).position, 9);
    // Panel: CHOMPI key, ENC_4, ENC_1, ENC_2, ENC_3, wheel x2, Play, Loop, volume.
    for(uint8_t i = 25; i < kLedCount; ++i)
    {
        CHECK(LocateLed(i).panel);
        CHECK_EQ(LocateLed(i).position, i - 25);
    }
    // Every chain position is used exactly once.
    int keys[kKeyLedCount] = {0}, panel[kPanelLedCount] = {0};
    for(uint8_t i = 0; i < kLedCount; ++i)
    {
        const LedLocation loc = LocateLed(i);
        if(loc.panel)
            panel[loc.position]++;
        else
            keys[loc.position]++;
    }
    for(int n : keys)
        CHECK_EQ(n, 1);
    for(int n : panel)
        CHECK_EQ(n, 1);
}

TEST("leds: brightness percent then the chain caps")
{
    CHECK_EQ(ScaleChannel(255, 100, false), 63); // keys 255 / 4
    CHECK_EQ(ScaleChannel(255, 100, true), 23);  // panel 255 / 11
    CHECK_EQ(ScaleChannel(255, 50, false), 31);  // 127 / 4
    CHECK_EQ(ScaleChannel(255, 50, true), 11);   // 127 / 11
    CHECK_EQ(ScaleChannel(255, 0, false), 0);
    CHECK_EQ(ScaleChannel(10, 100, true), 0);
    CHECK_EQ(ScaleChannel(200, 101, false), 50); // clamps to 100%
    for(int v = 0; v < 256; ++v)
    {
        CHECK(ScaleChannel(static_cast<uint8_t>(v), 100, false) <= 63);
        CHECK(ScaleChannel(static_cast<uint8_t>(v), 100, true) <= 23);
    }
}

TEST("leds: key chain is GRB and panel chain is RGB")
{
    Rgb leds[kLedCount];
    std::memset(leds, 0, sizeof(leds));
    leds[0]  = Rgb{40, 80, 120};  // key 1 -> key chain position 24
    leds[25] = Rgb{110, 55, 220}; // CHOMPI key -> panel position 0
    ChainFrame f;
    RenderFrame(leds, 100, &f);
    CHECK_EQ(f.keys[24][0], 80 / 4);  // G
    CHECK_EQ(f.keys[24][1], 40 / 4);  // R
    CHECK_EQ(f.keys[24][2], 120 / 4); // B
    CHECK_EQ(f.panel[0][0], 110 / 11); // R
    CHECK_EQ(f.panel[0][1], 55 / 11);  // G
    CHECK_EQ(f.panel[0][2], 220 / 11); // B
    for(int i = 0; i < 24; ++i)
        CHECK(f.keys[i][0] == 0 && f.keys[i][1] == 0 && f.keys[i][2] == 0);
    for(int i = 1; i < kPanelLedCount; ++i)
        CHECK(f.panel[i][0] == 0 && f.panel[i][1] == 0 && f.panel[i][2] == 0);
}

TEST("leds: disconnected pattern is a dim breathe on the CHOMPI key only")
{
    uint8_t lo = 255, hi = 0;
    for(uint32_t t = 0; t < 2 * kDisconnectedPeriodMs; t += 10)
    {
        ChainFrame f;
        RenderDisconnected(t, &f);
        for(int i = 0; i < kKeyLedCount; ++i)
            CHECK(f.keys[i][0] == 0 && f.keys[i][1] == 0 && f.keys[i][2] == 0);
        for(int i = 1; i < kPanelLedCount; ++i)
            CHECK(f.panel[i][0] == 0 && f.panel[i][1] == 0 && f.panel[i][2] == 0);
        // White: equal channels.
        CHECK(f.panel[0][0] == f.panel[0][1] && f.panel[0][1] == f.panel[0][2]);
        lo = f.panel[0][0] < lo ? f.panel[0][0] : lo;
        hi = f.panel[0][0] > hi ? f.panel[0][0] : hi;
    }
    CHECK(lo >= 1);  // never fully dark, so it reads as a pattern
    CHECK(hi <= kDisconnectedMaxLevel / kPanelCapDivisor);
    CHECK(hi > lo);  // it breathes
    ChainFrame a, b;
    RenderDisconnected(0, &a);
    RenderDisconnected(kDisconnectedPeriodMs / 2, &b);
    CHECK(a.panel[0][0] < b.panel[0][0]);
}
