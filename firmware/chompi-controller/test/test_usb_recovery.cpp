// USB recovery decisions: when the controller restarts its USB device.
#include "core/usb_recovery.h"
#include "test.h"

using namespace agentctl;

namespace
{
// Runs from `from` to `to` in 10 ms passes with a fixed state; returns how many
// restarts fired and, through `fired`, when (up to `max`).
int Run(UsbRecovery& r, uint32_t from, uint32_t to, bool configured, bool addressed,
        uint32_t* fired = nullptr, int max = 0)
{
    int restarts = 0;
    for(uint32_t t = from; t <= to; t += 10)
        if(r.Update(t, configured, addressed))
        {
            if(fired && restarts < max)
                fired[restarts] = t;
            ++restarts;
        }
    return restarts;
}
} // namespace

TEST("usb recovery: a configured or suspended device is never restarted")
{
    UsbRecovery r; // configured covers a device suspended under a sleeping host
    CHECK_EQ(Run(r, 0, 600000, true, false), 0);
}

TEST("usb recovery: unaddressed restarts after 3 s, then every 5 s")
{
    UsbRecovery r;
    Run(r, 0, 1000, true, false);
    uint32_t fired[5] = {};
    CHECK_EQ(Run(r, 1010, 24100, false, false, fired, 5), 5);
    CHECK_EQ(fired[0], 4010u);
    CHECK_EQ(fired[1], 9010u);
    CHECK_EQ(fired[2], 14010u);
    CHECK_EQ(fired[4], 24010u);
}

TEST("usb recovery: addressed but unconfigured waits 10 s and backs off to 320 s")
{
    UsbRecovery r;
    uint32_t    fired[8] = {};
    CHECK_EQ(Run(r, 0, 1400000, false, true, fired, 8), 8);
    // Gaps 10, 20, 40, 80, 160, 320, 320, 320 s.
    CHECK_EQ(fired[0], 10000u);
    CHECK_EQ(fired[1] - fired[0], 20000u);
    CHECK_EQ(fired[2] - fired[1], 40000u);
    CHECK_EQ(fired[3] - fired[2], 80000u);
    CHECK_EQ(fired[4] - fired[3], 160000u);
    CHECK_EQ(fired[5] - fired[4], 320000u);
    CHECK_EQ(fired[7] - fired[6], 320000u);
}

TEST("usb recovery: a configuration resets the back-off and the timers")
{
    UsbRecovery r;
    Run(r, 0, 80000, false, true); // restarts at 10 s and 30 s, back-off at 40 s
    Run(r, 80010, 90000, true, false);
    uint32_t fired[1] = {};
    CHECK_EQ(Run(r, 90010, 100500, false, true, fired, 1), 1);
    CHECK_EQ(fired[0], 100010u); // a fresh 10 s, not 40 s
    uint32_t again[1] = {};
    Run(r, 100510, 110000, true, false);
    CHECK_EQ(Run(r, 110010, 113100, false, false, again, 1), 1);
    CHECK_EQ(again[0], 113010u); // unaddressed: a fresh 3 s settle
}

TEST("usb recovery: re-enumeration that flips addressed and unaddressed keeps the back-off")
{
    // A disabled node: each restart re-attaches (unaddressed), the host
    // addresses it again within milliseconds and leaves it unconfigured.
    UsbRecovery r;
    uint32_t    t        = 0;
    uint32_t    fired[4] = {};
    int         n        = 0;
    bool        addressed = true;
    for(; t <= 400000 && n < 4; t += 10)
    {
        if(r.Update(t, false, addressed))
        {
            fired[n++] = t;
            addressed  = false; // the restart detaches; the host resets it
        }
        else if(!addressed)
            addressed = true; // SET_ADDRESS on the next pass
    }
    CHECK_EQ(n, 4);
    CHECK(fired[1] - fired[0] >= 20000u);
    CHECK(fired[2] - fired[1] >= 40000u);
    CHECK(fired[3] - fired[2] >= 80000u);
}

TEST("usb recovery: a short loss while the host re-enumerates needs no restart")
{
    UsbRecovery r;
    Run(r, 0, 1000, true, false);
    CHECK_EQ(Run(r, 1010, 1500, false, false), 0); // bus reset
    CHECK_EQ(Run(r, 1510, 2500, false, true), 0);  // addressed
    CHECK_EQ(Run(r, 2510, 60000, true, false), 0); // configured
}

TEST("usb recovery: the settle and the retries time correctly across the clock wrap")
{
    UsbRecovery    r;
    const uint32_t start    = 0xFFFFFFFFu - 999; // wraps 1000 ms in
    uint32_t       fired[3] = {};
    int            n        = 0;
    for(uint32_t i = 0; i <= 1400 && n < 3; ++i)
    {
        const uint32_t t = start + i * 10;
        if(r.Update(t, false, false))
            fired[n++] = t;
    }
    REQUIRE(n == 3);
    CHECK_EQ(fired[0], start + 3000u); // the settle spans the wrap
    CHECK_EQ(fired[1], fired[0] + 5000u);
    CHECK_EQ(fired[2], fired[1] + 5000u);
    CHECK(fired[0] < start); // the first restart is after the wrap
}
