// USB descriptor and string tests.
#include <cstring>
#include <string>

#include "core/usb_descriptors.h"
#include "test.h"

using namespace agentctl;

TEST("usb: device descriptor carries the protocol identity")
{
    const uint8_t* d = kUsbDeviceDescriptor;
    CHECK_EQ(d[0], 18);
    CHECK_EQ(d[1], 0x01);
    CHECK_EQ(d[4], 0); // class defined by the interface
    CHECK_EQ(d[7], 64);
    CHECK_EQ(d[8] | (d[9] << 8), 0x1209);
    CHECK_EQ(d[10] | (d[11] << 8), 0x000C);
    CHECK_EQ(d[12] | (d[13] << 8), kUsbBcdDevice);
    CHECK_EQ(d[14], 1); // manufacturer string
    CHECK_EQ(d[15], 2); // product string
    CHECK_EQ(d[16], 3); // serial string
    CHECK_EQ(d[17], 1);
}

TEST("usb: one HID interface with 64-byte 1 ms interrupt endpoints")
{
    const uint8_t* c = kUsbConfigDescriptor;
    CHECK_EQ(c[0], 9);
    CHECK_EQ(c[1], 0x02);
    CHECK_EQ(c[2] | (c[3] << 8), static_cast<int>(sizeof(kUsbConfigDescriptor)));
    CHECK_EQ(c[4], 1);
    // Interface: HID, no boot subclass, two endpoints.
    CHECK_EQ(c[9 + 1], 0x04);
    CHECK_EQ(c[9 + 4], 2);
    CHECK_EQ(c[9 + 5], 0x03);
    CHECK_EQ(c[9 + 6], 0);
    CHECK_EQ(c[9 + 7], 0);
    // HID descriptor points at the report descriptor.
    const uint8_t* hid = c + kHidDescriptorOffset;
    CHECK_EQ(hid[0], kHidDescriptorSize);
    CHECK_EQ(hid[1], 0x21);
    CHECK_EQ(hid[6], 0x22);
    CHECK_EQ(hid[7] | (hid[8] << 8), static_cast<int>(kHidReportDescriptorSize));
    // Endpoints.
    for(int i = 0; i < 2; ++i)
    {
        const uint8_t* ep = c + 27 + 7 * i;
        CHECK_EQ(ep[0], 7);
        CHECK_EQ(ep[1], 0x05);
        CHECK_EQ(ep[2], i == 0 ? kHidInEndpoint : kHidOutEndpoint);
        CHECK_EQ(ep[3], 0x03); // interrupt
        CHECK_EQ(ep[4] | (ep[5] << 8), 64);
        CHECK_EQ(ep[6], 1);
    }
}

TEST("usb: report descriptor is one vendor collection of 64-byte reports")
{
    const uint8_t* r = kHidReportDescriptor;
    const size_t   n = kHidReportDescriptorSize;
    REQUIRE(n > 10);
    // Usage page 0xFF00, usage 0x01, application collection.
    CHECK(r[0] == 0x06 && r[1] == 0x00 && r[2] == 0xFF);
    CHECK(r[3] == 0x09 && r[4] == 0x01);
    CHECK(r[5] == 0xA1 && r[6] == 0x01);
    CHECK_EQ(r[n - 1], 0xC0);
    // No report ID item, and both report counts are 64 bytes of 8 bits.
    int counts = 0, inputs = 0, outputs = 0;
    for(size_t i = 0; i < n;)
    {
        const uint8_t prefix = r[i];
        const size_t  size   = (prefix & 0x03) == 3 ? 4 : (prefix & 0x03);
        CHECK(prefix != 0x85);
        if(prefix == 0x95)
        {
            CHECK_EQ(r[i + 1], 64);
            ++counts;
        }
        if(prefix == 0x75)
            CHECK_EQ(r[i + 1], 8);
        if(prefix == 0x81)
            ++inputs;
        if(prefix == 0x91)
            ++outputs;
        i += 1 + size;
    }
    CHECK_EQ(counts, 2);
    CHECK_EQ(inputs, 1);
    CHECK_EQ(outputs, 1);
}

TEST("usb: serial is 24 uppercase hex digits from the unique ID")
{
    char serial[kUsbSerialDigits + 1];
    FormatSerial(0x0012ABCDu, 0xDEADBEEFu, 0x00000001u, serial);
    CHECK_EQ(std::string(serial), std::string("0012ABCDDEADBEEF00000001"));
    CHECK_EQ(std::strlen(serial), 24u);
}

TEST("usb: string descriptors are UTF-16LE and bounded")
{
    uint8_t buf[64];
    const size_t n = BuildStringDescriptor(kUsbProduct, buf, sizeof(buf));
    CHECK_EQ(n, 2 + 2 * std::strlen(kUsbProduct));
    CHECK_EQ(buf[0], n);
    CHECK_EQ(buf[1], 0x03);
    CHECK(buf[2] == 'A' && buf[3] == 0);
    CHECK_EQ(BuildStringDescriptor("0123456789012345678901234567890123", buf,
                                   sizeof(buf)),
             0u);
    CHECK_EQ(std::string(kUsbManufacturer), std::string("agent-device-hub"));
    CHECK_EQ(std::string(kUsbProduct), std::string("Agent Controller"));
}
