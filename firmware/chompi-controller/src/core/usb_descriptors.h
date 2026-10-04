// USB descriptors for the vendor-defined HID interface, and string helpers.
//
// Identity from packages/chompi-protocol/README.md: VID:PID 1209:000C,
// "agent-device-hub" / "Agent Controller", a 24-hex-digit serial from the
// STM32 unique ID, one vendor collection (usage page 0xFF00, usage 0x01),
// 64-byte input and output reports without a report ID, 1 ms interval.
#pragma once

#include <cstddef>
#include <cstdint>

#include "protocol.h"

namespace agentctl
{

constexpr uint16_t kUsbVendorId  = 0x1209;
constexpr uint16_t kUsbProductId = 0x000C;
constexpr uint16_t kUsbBcdDevice = (kFirmwareMajor << 8) | (kFirmwareMinor << 4)
                                   | kFirmwarePatch;

constexpr char kUsbManufacturer[] = "agent-device-hub";
constexpr char kUsbProduct[]      = "Agent Controller";

constexpr uint8_t kHidInEndpoint  = 0x81;
constexpr uint8_t kHidOutEndpoint = 0x01;
constexpr uint8_t kHidPacketSize  = 64;
constexpr uint8_t kHidIntervalMs  = 1;

constexpr uint8_t kUsbSerialDigits = 24;

// Writes kUsbSerialDigits uppercase hex digits and a terminating NUL.
void FormatSerial(uint32_t uid0, uint32_t uid1, uint32_t uid2,
                  char out[kUsbSerialDigits + 1]);

// Builds a USB string descriptor (UTF-16LE of ASCII text). Returns its length,
// or 0 when it does not fit in `capacity`.
size_t BuildStringDescriptor(const char* text, uint8_t* out, size_t capacity);

// Descriptor bytes. Non-const because the ST USB core takes uint8_t*.
extern uint8_t       kUsbDeviceDescriptor[18];
extern uint8_t       kUsbConfigDescriptor[41];
extern uint8_t       kUsbQualifierDescriptor[10];
extern uint8_t       kUsbLangIdDescriptor[4];
extern uint8_t       kHidReportDescriptor[];
extern const size_t  kHidReportDescriptorSize;
constexpr size_t     kHidDescriptorOffset = 18; // inside the config descriptor
constexpr size_t     kHidDescriptorSize   = 9;

} // namespace agentctl
