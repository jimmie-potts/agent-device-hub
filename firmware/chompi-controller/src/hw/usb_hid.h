// Vendor-defined HID class on libDaisy's ST USB device core (USB_OTG_HS with
// the internal full-speed PHY, the CHOMPI USB-C jack).
//
// Follows the custom-class pattern of the CHOMPI USB storage firmware
// (lnetzel/CHOMPI-lnetzel a609509, firmware/chompi-usb-storage/code/src/
// usb_msc.cpp, MIT License, Copyright (c) 2026 CHOMPI Club): own descriptors
// and USBD_ClassTypeDef registered with USBD_Init(DEVICE_HS), no libDaisy
// rebuild. Callbacks run in the USB interrupt; the main loop talks to them
// only through the functions below.
#pragma once

#include <cstddef>
#include <cstdint>

#include "core/protocol.h"

namespace agentctl
{
namespace hw
{

enum class UsbHidInitResult : uint8_t
{
    Ready,
    CoreInitFailed,
    ClassRegistrationFailed,
    DeviceStartFailed,
};

// `serial` must stay valid; it is read on each serial string request.
UsbHidInitResult UsbHidInit(const char* serial);

// Stops the device and detaches it from the bus.
void UsbHidStop();

// Increments on every SET_CONFIGURATION, i.e. every enumeration.
uint32_t UsbHidGeneration();
bool     UsbHidConfigured();
// The host addressed the device but did not configure it, also while
// suspended in that state.
bool     UsbHidAddressedUnconfigured();

// True when configured, not suspended and the IN endpoint is idle.
bool UsbHidCanSend();
bool UsbHidSend(const uint8_t report[kReportSize]);

// Pops one received output report. `length` is what the host sent.
bool UsbHidReceive(uint8_t report[kReportSize], size_t* length);

// Output reports dropped because the main loop fell behind.
uint32_t UsbHidRxDropped();

} // namespace hw
} // namespace agentctl
