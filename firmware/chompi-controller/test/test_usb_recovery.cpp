// USB recovery decisions: when the controller restarts its USB device.
#include "core/usb_recovery.h"
#include "test.h"

using namespace agentctl;

namespace
{
// Runs from `from` to `to` in 10 ms passes; returns how many restarts fired
// and, through `last`, when the last one did. A restart detaches the device,
// so it stays unconfigured unless the caller says otherwise.
int Run(UsbRecovery& r, uint32_t from, uint32_t to, bool configured, uint32_t* last = nullptr, bool addressed = false)
{
    int restarts = 0;
    for(uint32_t t = from; t <= to; t += 10)
        if(r.Update(t, configured, addressed))
        {
            ++restarts;
            if(last)
                *last = t;
        }
    return restarts;
}
} // namespace

TEST("usb recovery: a configured or suspended device is never restarted")
{
    UsbRecovery r; // configured covers a device suspended under a sleeping host
    CHECK_EQ(Run(r, 0, 600000, true), 0);
}

TEST("usb recovery: unconfigured restarts after 3 s, then every 5 s")
{
    UsbRecovery r;
    Run(r, 0, 1000, true);
    uint32_t last = 0;
    CHECK_EQ(Run(r, 1010, 4000, false, &last), 0);
    CHECK_EQ(Run(r, 4010, 4100, false, &last), 1);
    CHECK_EQ(last, 4010u);
    CHECK_EQ(Run(r, 4110, 9000, false), 0);
    CHECK_EQ(Run(r, 9010, 9100, false), 1);
    CHECK_EQ(Run(r, 9110, 24100, false), 3);
}

TEST("usb recovery: a configuration stops the retries and resets the timer")
{
    UsbRecovery r;
    CHECK_EQ(Run(r, 0, 3100, false), 1);
    CHECK_EQ(Run(r, 3110, 60000, true), 0);
    // Lost again later: a fresh 3 s settle, not the 5 s retry.
    uint32_t last = 0;
    CHECK_EQ(Run(r, 60010, 63100, false, &last), 1);
    CHECK_EQ(last, 63010u);
}

TEST("usb recovery: a short loss while the host re-enumerates needs no restart")
{
    UsbRecovery r;
    Run(r, 0, 1000, true);
    CHECK_EQ(Run(r, 1010, 2500, false), 0); // bus reset and enumeration
    CHECK_EQ(Run(r, 2510, 60000, true), 0);
}

TEST("usb recovery: a device the host addressed but left unconfigured is never restarted")
{
    // A disabled device node, a failed or slow driver install, SET_CONFIGURATION 0.
    UsbRecovery r;
    CHECK_EQ(Run(r, 0, 600000, false, nullptr, true), 0);
    // Back to unaddressed (bus reset, no address): a fresh 3 s settle.
    uint32_t last = 0;
    CHECK_EQ(Run(r, 600010, 603100, false, &last), 1);
    CHECK_EQ(last, 603010u);
}

TEST("usb recovery: the settle and the retries time correctly across the clock wrap")
{
    UsbRecovery    r;
    const uint32_t start = 0xFFFFFFFFu - 999; // wraps 1000 ms in
    uint32_t       fired[3];
    int            n = 0;
    for(uint32_t i = 0; i <= 1400 && n < 3; ++i)
    {
        const uint32_t t = start + i * 10;
        if(r.Update(t, false, false))
            fired[n++] = t;
    }
    CHECK_EQ(n, 3);
    CHECK_EQ(fired[0], start + 3000u);  // settle spans the wrap
    CHECK_EQ(fired[1], fired[0] + 5000u);
    CHECK_EQ(fired[2], fired[1] + 5000u);
    CHECK(fired[0] < start);             // the first restart is after the wrap
}
