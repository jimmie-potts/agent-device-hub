#include "usb_descriptors.h"

namespace agentctl
{
namespace
{
constexpr uint8_t Lo(uint16_t v) { return static_cast<uint8_t>(v & 0xFF); }
constexpr uint8_t Hi(uint16_t v) { return static_cast<uint8_t>(v >> 8); }
} // namespace

uint8_t kHidReportDescriptor[] = {
    0x06, 0x00, 0xFF, // Usage Page (Vendor 0xFF00)
    0x09, 0x01,       // Usage (0x01)
    0xA1, 0x01,       // Collection (Application)
    0x15, 0x00,       //   Logical Minimum (0)
    0x26, 0xFF, 0x00, //   Logical Maximum (255)
    0x75, 0x08,       //   Report Size (8)
    0x95, 0x40,       //   Report Count (64)
    0x09, 0x02,       //   Usage (0x02)
    0x81, 0x02,       //   Input (Data, Variable, Absolute)
    0x95, 0x40,       //   Report Count (64)
    0x09, 0x03,       //   Usage (0x03)
    0x91, 0x02,       //   Output (Data, Variable, Absolute)
    0xC0,             // End Collection
};
const size_t kHidReportDescriptorSize = sizeof(kHidReportDescriptor);

namespace
{
constexpr uint16_t kReportDescriptorLength = sizeof(kHidReportDescriptor);
} // namespace

uint8_t kUsbDeviceDescriptor[18] = {
    18,   0x01,                                 // bLength, DEVICE
    0x00, 0x02,                                 // bcdUSB 2.00
    0x00, 0x00, 0x00,                           // class from interface
    64,                                         // bMaxPacketSize0
    Lo(kUsbVendorId),  Hi(kUsbVendorId),        // idVendor
    Lo(kUsbProductId), Hi(kUsbProductId),       // idProduct
    Lo(kUsbBcdDevice), Hi(kUsbBcdDevice),       // bcdDevice
    1,    2,    3,                              // strings
    1,                                          // bNumConfigurations
};

uint8_t kUsbConfigDescriptor[41] = {
    // Configuration
    9, 0x02, 41, 0, 1, 1, 0,
    0xC0, // self-powered (battery)
    50,   // 100 mA
    // Interface 0: HID, no boot protocol, two endpoints
    9, 0x04, 0, 0, 2, 0x03, 0x00, 0x00, 0,
    // HID 1.11
    9, 0x21, 0x11, 0x01, 0, 1, 0x22, Lo(kReportDescriptorLength),
    Hi(kReportDescriptorLength),
    // Interrupt IN
    7, 0x05, kHidInEndpoint, 0x03, kHidPacketSize, 0, kHidIntervalMs,
    // Interrupt OUT
    7, 0x05, kHidOutEndpoint, 0x03, kHidPacketSize, 0, kHidIntervalMs,
};

uint8_t kUsbQualifierDescriptor[10] = {10, 0x06, 0x00, 0x02, 0, 0, 0, 64, 1, 0};

uint8_t kUsbLangIdDescriptor[4] = {4, 0x03, 0x09, 0x04}; // en-US

void FormatSerial(uint32_t uid0, uint32_t uid1, uint32_t uid2,
                  char out[kUsbSerialDigits + 1])
{
    static const char kHex[] = "0123456789ABCDEF";
    const uint32_t    words[3] = {uid0, uid1, uid2};
    size_t            n        = 0;
    for(uint32_t w : words)
        for(int shift = 28; shift >= 0; shift -= 4)
            out[n++] = kHex[(w >> shift) & 0x0F];
    out[n] = '\0';
}

size_t BuildStringDescriptor(const char* text, uint8_t* out, size_t capacity)
{
    size_t length = 0;
    while(text[length] != '\0')
        ++length;
    const size_t total = 2 + 2 * length;
    if(total > capacity || total > 255)
        return 0;
    out[0] = static_cast<uint8_t>(total);
    out[1] = 0x03;
    for(size_t i = 0; i < length; ++i)
    {
        out[2 + 2 * i] = static_cast<uint8_t>(text[i]);
        out[3 + 2 * i] = 0;
    }
    return total;
}

} // namespace agentctl
