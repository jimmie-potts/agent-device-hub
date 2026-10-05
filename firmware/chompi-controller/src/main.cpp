// Agent controller firmware for the CHOMPI, launcher slot 04.
//
// Vendor HID protocol v1 (packages/chompi-protocol). No audio, no MIDI, no SD
// card: the card is never mounted, so this firmware cannot touch music data.
// Boot holds used by the stock firmware (CHOMPI+Play+Loop shipping mode,
// volume-click test mode) are not implemented or reused; a key held at power-on
// is ignored until it is released.
#include "core/controller.h"
#include "core/epoch.h"
#include "core/input.h"
#include "core/usb_descriptors.h"
#include "core/usb_recovery.h"
#include "daisy_seed.h"
#include "hw/board.h"
#include "hw/led_driver.h"
#include "hw/usb_hid.h"
#include "hw/usb_switch.h"

using namespace agentctl;

namespace
{
hw::Board    board;
Controller   controller;
InputScanner scanner;
UsbRecovery  usb_recovery;
char         serial[kUsbSerialDigits + 1];

constexpr uint32_t kLedRefreshMs   = 10;
constexpr uint32_t kBatteryCheckMs = 100;

// Teardown before power is cut or the core is reset: stop the LED DMA so no
// WS2812 frame is cut short, leave USB cleanly and give the data lines back
// to the charger, as the launcher does before a handover.
void PrepareForPowerOff()
{
    hw::LedsOff();
    hw::StopLeds();
    daisy::System::Delay(20);
    hw::UsbHidStop();
    hw::UsbReleaseLines(board);
    daisy::System::Delay(100);
}
} // namespace

int main()
{
    board.Init();
    hw::LedSetup();

    ChainFrame frame;
    RenderDisconnected(0, &frame);
    hw::LedShow(frame);

    hw::UsbTakeOver(board);
    uint32_t uid[3];
    dsy_get_unique_id(&uid[0], &uid[1], &uid[2]);
    FormatSerial(uid[0], uid[1], uid[2], serial);
    hw::UsbHidInit(serial);

    controller.Reset();
    scanner.Reset();

    uint32_t seen_generation = 0;
    uint16_t epoch           = 0;
    uint32_t last_scan       = daisy::System::GetNow();
    uint32_t last_led        = last_scan;
    uint32_t last_battery    = last_scan;

    while(true)
    {
        const uint32_t now = daisy::System::GetNow();
        hw::ServiceUsbSwitch(board, now);

        // #743: the device stack does not recover from a disconnect by itself.
        // Detach and re-attach; the controller sees a new enumeration below.
        if(usb_recovery.Update(now, hw::UsbHidConfigured(), hw::UsbHidAddressedUnconfigured()))
        {
            hw::UsbHidStop();
            hw::UsbReclaimLines(board, now);
            hw::UsbHidInit(serial);
        }

        // Every enumeration starts a new epoch.
        const uint32_t generation = hw::UsbHidGeneration();
        if(generation != seen_generation)
        {
            seen_generation = generation;
            epoch           = NextEpoch(epoch, daisy::Random::GetValue());
            controller.OnUsbConfigured(epoch, now);
        }
        else if(!hw::UsbHidConfigured() && controller.configured())
        {
            controller.OnUsbDeconfigured();
        }

        uint8_t report[kReportSize];
        size_t  length = 0;
        while(hw::UsbHidReceive(report, &length))
            controller.OnHostReport(report, length, now);

        // Controls at 1 kHz, like the stock firmware.
        if(now != last_scan)
        {
            last_scan = now;
            RawInputs raw;
            board.ReadInputs(&raw);
            InputEvent   events[InputScanner::kMaxEventsPerSample];
            const size_t n
                = scanner.Sample(raw, events, InputScanner::kMaxEventsPerSample);
            for(size_t i = 0; i < n; ++i)
                controller.OnInput(events[i]);
        }

        controller.Update(now, scanner.DownMask());
        if(hw::UsbHidCanSend() && controller.NextReport(report))
            hw::UsbHidSend(report);

        if(now - last_led >= kLedRefreshMs)
        {
            last_led = now;
            controller.Render(now, &frame);
            hw::LedShow(frame);
        }

        if(now - last_battery >= kBatteryCheckMs)
        {
            last_battery = now;
            board.LowBatteryLockoutCheck(PrepareForPowerOff);
        }
    }
}
