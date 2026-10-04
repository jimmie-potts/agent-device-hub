// USB3740B data-line switch handshake with the MP2722 charger.
//
// Adapted from UsbTakeOver() and ServiceUsbSwitch() in sfaber02/CHOMPI
// launcher-v1.1 (79ea9e7), firmware/chompi-launcher/code/src/launcher_main.cpp.
// MIT License, Copyright (c) 2026 CHOMPI Club; see THIRD_PARTY.md. The card
// logging is removed; the register writes and timing are unchanged.
#pragma once

#include <cstdint>

#include "board.h"

namespace agentctl
{
namespace hw
{

// Power-on: let the charger detect the port, then take the lines.
void UsbTakeOver(Board& board);

// Call every main-loop pass. On a charger interrupt, lends the lines for a
// fresh detection when the port type is unknown, and always takes them back.
void ServiceUsbSwitch(Board& board, uint32_t now);

// Gives the lines back to the charger, as at power-on.
void UsbReleaseLines(Board& board);

} // namespace hw
} // namespace agentctl
