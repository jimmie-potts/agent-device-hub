// Adapted from sfaber02/CHOMPI launcher-v1.1 (79ea9e7),
// firmware/chompi-launcher/code/src/launcher_main.cpp (UsbTakeOver,
// ServiceUsbSwitch). MIT License, Copyright (c) 2026 CHOMPI Club; see
// THIRD_PARTY.md.
#include "usb_switch.h"

namespace agentctl
{
namespace hw
{
namespace
{
bool     prev_int_state = true;
bool     usb_handoff    = false;
uint32_t usb_handoff_t  = 0;
bool     usb_lent       = false; // lines are with the charger
uint32_t usb_lent_t     = 0;
uint32_t usb_quiet_t    = 0; // ignore "unknown" until then

bool PortUnknown(const Board& board)
{
    return (board.ChargerRegister(0) & 0B11110000) == 0; // DPDM_STAT
}
} // namespace

void UsbTakeOver(Board& board)
{
    board.MpWrite(0x0c, 0B01010001); // BATT_LOW at 3 V, as TAPE does
    board.ChargerRead();
    daisy::System::Delay(100);

    board.usb_sw.Write(false); // give USB to the charger
    daisy::System::Delay(1);
    board.MpWrite(0x0a, 0B00100100); // auto DPDM
    daisy::System::Delay(1);
    board.usb_sw.Write(true); // take it back
}

void ServiceUsbSwitch(Board& board, uint32_t now)
{
    const bool int_state = board.mpc_int.Read();
    const bool interrupt = !int_state && prev_int_state;
    prev_int_state       = int_state;

    if(interrupt)
    {
        if(!board.ChargerRead())
        {
            // Stale registers could lend the lines out for good; retry next pass.
            prev_int_state = true;
        }
        else if(PortUnknown(board) && usb_lent)
        {
            // Our forced detection came back empty: take the lines anyway.
            board.usb_sw.Write(true);
            usb_lent    = false;
            usb_quiet_t = now + 5000;
        }
        else if(PortUnknown(board) && static_cast<int32_t>(now - usb_quiet_t) < 0)
        {
            // Still settling from the last round.
        }
        else if(PortUnknown(board))
        {
            board.usb_sw.Write(false);
            usb_handoff   = true;
            usb_handoff_t = now;
            usb_lent      = true;
            usb_lent_t    = now;
        }
        else
        {
            board.usb_sw.Write(true);
            usb_lent = false;
        }
    }

    if(usb_handoff && now - usb_handoff_t > 1)
    {
        usb_handoff = false;
        board.MpWrite(0x0a, 0B00110100); // force DPDM
    }

    // If the second interrupt never comes, take the lines back anyway.
    if(usb_lent && now - usb_lent_t > 1500)
    {
        board.usb_sw.Write(true);
        usb_lent    = false;
        usb_quiet_t = now + 5000;
    }
}

void UsbReleaseLines(Board& board) { board.usb_sw.Write(false); }

bool UsbLinesLent() { return usb_lent || usb_handoff; }

void UsbReclaimLines(Board& board, uint32_t now)
{
    if(usb_lent || usb_handoff)
        usb_quiet_t = now + 5000;
    board.usb_sw.Write(true);
    usb_handoff = false;
    usb_lent    = false;
}

} // namespace hw
} // namespace agentctl
