// USB recovery decisions: when the controller restarts its USB device.
#include "core/usb_recovery.h"
#include "test.h"

using namespace agentctl;

namespace
{
// Runs from `from` to `to` in 10 ms passes; returns how many restarts fired
// and, through `last`, when the last one did. A restart detaches the device,
// so it stays unconfigured unless the caller says otherwise.
int Run(UsbRecovery& r, uint32_t from, uint32_t to, bool configured, uint32_t* last = nullptr)
{
    int restarts = 0;
    for(uint32_t t = from; t <= to; t += 10)
        if(r.Update(t, configured))
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

TEST("usb recovery: the clock may wrap")
{
    UsbRecovery    r;
    const uint32_t start = 0xFFFFF000u;
    int            restarts = 0;
    for(uint32_t i = 0; i <= 400; ++i)
        if(r.Update(start + i * 10, false))
            ++restarts;
    CHECK_EQ(restarts, 1);
}
