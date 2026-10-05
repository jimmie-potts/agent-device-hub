// Custom-class pattern from lnetzel/CHOMPI-lnetzel a609509,
// firmware/chompi-usb-storage/code/src/usb_msc.cpp (MIT License, Copyright
// (c) 2026 CHOMPI Club; see THIRD_PARTY.md). The HID requests follow the USB
// HID 1.11 specification.
#include "usb_hid.h"

#include <cstring>

#include "core/usb_descriptors.h"
#include "stm32h7xx_hal.h"
#include "usbd_core.h"
#include "usbd_ctlreq.h"
#include "usbd_def.h"
#include "usbd_ioreq.h"

namespace agentctl
{
namespace hw
{
namespace
{
constexpr uint8_t kHidDescriptorType       = 0x21;
constexpr uint8_t kHidReportDescriptorType = 0x22;
constexpr uint8_t kHidReqGetReport         = 0x01;
constexpr uint8_t kHidReqGetIdle           = 0x02;
constexpr uint8_t kHidReqGetProtocol       = 0x03;
constexpr uint8_t kHidReqSetReport         = 0x09;
constexpr uint8_t kHidReqSetIdle           = 0x0A;
constexpr uint8_t kHidReqSetProtocol       = 0x0B;

constexpr size_t kRxSlots = 8; // power of two

USBD_HandleTypeDef usb_device;
const char*        serial_text = "";

// Interrupt-side state, shared with the main loop.
struct HidState
{
    volatile bool     configured = false;
    volatile bool     tx_busy    = false;
    volatile uint32_t generation = 0;
    volatile uint32_t rx_dropped = 0;
    uint8_t           idle       = 0;
    uint8_t           protocol   = 1;
    uint8_t           alt        = 0;
    uint8_t           ctl_length = 0;
};
HidState state;

alignas(4) uint8_t rx_packet[kReportSize];
alignas(4) uint8_t tx_packet[kReportSize];
alignas(4) uint8_t ctl_buffer[kReportSize];
uint8_t            string_buffer[64];

// Single-producer (USB IRQ), single-consumer (main loop) ring.
uint8_t           rx_ring[kRxSlots][kReportSize];
uint8_t           rx_length[kRxSlots];
volatile uint32_t rx_head = 0; // written by the IRQ
volatile uint32_t rx_tail = 0; // written by the main loop

void PushReport(const uint8_t* data, size_t length)
{
    const uint32_t head = rx_head;
    if(head - rx_tail >= kRxSlots)
    {
        state.rx_dropped = state.rx_dropped + 1;
        return;
    }
    const size_t n = length > kReportSize ? kReportSize : length;
    std::memcpy(rx_ring[head % kRxSlots], data, n);
    rx_length[head % kRxSlots] = static_cast<uint8_t>(n);
    __DMB();
    rx_head = head + 1;
}

uint8_t HidInit(USBD_HandleTypeDef* device, uint8_t)
{
    USBD_LL_OpenEP(device, kHidInEndpoint, USBD_EP_TYPE_INTR, kHidPacketSize);
    USBD_LL_OpenEP(device, kHidOutEndpoint, USBD_EP_TYPE_INTR, kHidPacketSize);
    device->ep_in[kHidInEndpoint & 0x0F].is_used   = 1U;
    device->ep_out[kHidOutEndpoint & 0x0F].is_used = 1U;
    // Non-null pClassData makes the core call DeInit on a bus reset.
    device->pClassData = &state;
    state.tx_busy      = false;
    state.alt          = 0;
    state.configured   = true;
    state.generation   = state.generation + 1;
    USBD_LL_PrepareReceive(device, kHidOutEndpoint, rx_packet, kReportSize);
    return USBD_OK;
}

uint8_t HidDeInit(USBD_HandleTypeDef* device, uint8_t)
{
    state.configured = false;
    state.tx_busy    = false;
    USBD_LL_CloseEP(device, kHidInEndpoint);
    USBD_LL_CloseEP(device, kHidOutEndpoint);
    device->ep_in[kHidInEndpoint & 0x0F].is_used   = 0U;
    device->ep_out[kHidOutEndpoint & 0x0F].is_used = 0U;
    device->pClassData = nullptr;
    return USBD_OK;
}

uint8_t Fail(USBD_HandleTypeDef* device, USBD_SetupReqTypedef* request)
{
    USBD_CtlError(device, request);
    return USBD_FAIL;
}

uint8_t HidSetup(USBD_HandleTypeDef* device, USBD_SetupReqTypedef* request)
{
    static uint8_t one_byte  = 0;
    static uint8_t status[2] = {0, 0};
    const bool configured = device->dev_state == USBD_STATE_CONFIGURED;

    switch(request->bmRequest & USB_REQ_TYPE_MASK)
    {
        case USB_REQ_TYPE_CLASS:
            switch(request->bRequest)
            {
                case kHidReqSetIdle: state.idle = HIBYTE(request->wValue); return USBD_OK;
                case kHidReqGetIdle:
                    one_byte = state.idle;
                    USBD_CtlSendData(device, &one_byte, 1);
                    return USBD_OK;
                case kHidReqSetProtocol:
                    state.protocol = LOBYTE(request->wValue);
                    return USBD_OK;
                case kHidReqGetProtocol:
                    one_byte = state.protocol;
                    USBD_CtlSendData(device, &one_byte, 1);
                    return USBD_OK;
                case kHidReqSetReport:
                    // An output report over the control pipe (HidD_SetOutputReport).
                    if(request->wLength == 0 || request->wLength > kReportSize)
                        return Fail(device, request);
                    state.ctl_length = static_cast<uint8_t>(request->wLength);
                    USBD_CtlPrepareRx(device, ctl_buffer, request->wLength);
                    return USBD_OK;
                case kHidReqGetReport: // input reports only travel on EP 0x81
                default: return Fail(device, request);
            }

        case USB_REQ_TYPE_STANDARD:
            switch(request->bRequest)
            {
                case USB_REQ_GET_STATUS:
                    if(!configured)
                        return Fail(device, request);
                    USBD_CtlSendData(device, status, 2);
                    return USBD_OK;
                case USB_REQ_GET_DESCRIPTOR:
                {
                    uint8_t* data   = nullptr;
                    uint16_t length = 0;
                    if(HIBYTE(request->wValue) == kHidReportDescriptorType)
                    {
                        data   = kHidReportDescriptor;
                        length = static_cast<uint16_t>(kHidReportDescriptorSize);
                    }
                    else if(HIBYTE(request->wValue) == kHidDescriptorType)
                    {
                        data   = kUsbConfigDescriptor + kHidDescriptorOffset;
                        length = kHidDescriptorSize;
                    }
                    else
                        return Fail(device, request);
                    if(length > request->wLength)
                        length = request->wLength;
                    USBD_CtlSendData(device, data, length);
                    return USBD_OK;
                }
                case USB_REQ_GET_INTERFACE:
                    if(!configured)
                        return Fail(device, request);
                    one_byte = state.alt;
                    USBD_CtlSendData(device, &one_byte, 1);
                    return USBD_OK;
                case USB_REQ_SET_INTERFACE:
                    if(!configured || LOBYTE(request->wValue) != 0)
                        return Fail(device, request);
                    state.alt = 0;
                    return USBD_OK;
                case USB_REQ_CLEAR_FEATURE: return USBD_OK;
                default: return Fail(device, request);
            }

        default: return Fail(device, request);
    }
}

uint8_t HidEp0RxReady(USBD_HandleTypeDef*)
{
    if(state.ctl_length != 0)
    {
        PushReport(ctl_buffer, state.ctl_length);
        state.ctl_length = 0;
    }
    return USBD_OK;
}

uint8_t HidDataIn(USBD_HandleTypeDef*, uint8_t endpoint)
{
    if(endpoint == (kHidInEndpoint & 0x7F))
        state.tx_busy = false;
    return USBD_OK;
}

uint8_t HidDataOut(USBD_HandleTypeDef* device, uint8_t endpoint)
{
    if(endpoint != kHidOutEndpoint)
        return USBD_OK;
    PushReport(rx_packet, USBD_LL_GetRxDataSize(device, kHidOutEndpoint));
    USBD_LL_PrepareReceive(device, kHidOutEndpoint, rx_packet, kReportSize);
    return USBD_OK;
}

uint8_t HidEp0TxSent(USBD_HandleTypeDef*) { return USBD_OK; }
uint8_t HidSof(USBD_HandleTypeDef*) { return USBD_OK; }
uint8_t HidIsoIn(USBD_HandleTypeDef*, uint8_t) { return USBD_OK; }
uint8_t HidIsoOut(USBD_HandleTypeDef*, uint8_t) { return USBD_OK; }

uint8_t* GetConfigDescriptor(uint16_t* length)
{
    *length = sizeof(kUsbConfigDescriptor);
    return kUsbConfigDescriptor;
}

uint8_t* GetOtherSpeedConfigDescriptor(uint16_t* length)
{
    static uint8_t other[sizeof(kUsbConfigDescriptor)];
    std::memcpy(other, kUsbConfigDescriptor, sizeof(other));
    other[1] = 0x07; // OTHER_SPEED_CONFIGURATION
    *length  = sizeof(other);
    return other;
}

uint8_t* GetQualifierDescriptor(uint16_t* length)
{
    *length = sizeof(kUsbQualifierDescriptor);
    return kUsbQualifierDescriptor;
}

uint8_t* GetUserString(USBD_HandleTypeDef*, uint8_t, uint16_t* length)
{
    *length = 0;
    return nullptr;
}

uint8_t* StringDescriptor(const char* text, uint16_t* length)
{
    *length = static_cast<uint16_t>(
        BuildStringDescriptor(text, string_buffer, sizeof(string_buffer)));
    return string_buffer;
}

uint8_t* GetDeviceDescriptor(USBD_SpeedTypeDef, uint16_t* length)
{
    *length = sizeof(kUsbDeviceDescriptor);
    return kUsbDeviceDescriptor;
}

uint8_t* GetLangId(USBD_SpeedTypeDef, uint16_t* length)
{
    *length = sizeof(kUsbLangIdDescriptor);
    return kUsbLangIdDescriptor;
}

uint8_t* GetManufacturer(USBD_SpeedTypeDef, uint16_t* length)
{
    return StringDescriptor(kUsbManufacturer, length);
}

uint8_t* GetProduct(USBD_SpeedTypeDef, uint16_t* length)
{
    return StringDescriptor(kUsbProduct, length);
}

uint8_t* GetSerial(USBD_SpeedTypeDef, uint16_t* length)
{
    return StringDescriptor(serial_text, length);
}

uint8_t* GetEmptyString(USBD_SpeedTypeDef, uint16_t* length)
{
    return StringDescriptor("", length);
}

USBD_DescriptorsTypeDef descriptors = {
    GetDeviceDescriptor,
    GetLangId,
    GetManufacturer,
    GetProduct,
    GetSerial,
    GetEmptyString, // configuration (index 0 in the descriptor, never asked)
    GetEmptyString, // interface (index 0 in the descriptor, never asked)
};

USBD_ClassTypeDef hid_class = {
    HidInit,
    HidDeInit,
    HidSetup,
    HidEp0TxSent,
    HidEp0RxReady,
    HidDataIn,
    HidDataOut,
    HidSof,
    HidIsoIn,
    HidIsoOut,
    GetConfigDescriptor,
    GetConfigDescriptor,
    GetOtherSpeedConfigDescriptor,
    GetQualifierDescriptor,
    GetUserString,
};

// Masks interrupts for a short critical section.
class IrqGuard
{
  public:
    IrqGuard() : primask_(__get_PRIMASK()) { __disable_irq(); }
    ~IrqGuard() { __set_PRIMASK(primask_); }

  private:
    uint32_t primask_;
};
} // namespace

UsbHidInitResult UsbHidInit(const char* serial)
{
    serial_text = serial;
    HAL_PWREx_EnableUSBVoltageDetector();
    if(USBD_Init(&usb_device, &descriptors, DEVICE_HS) != USBD_OK)
        return UsbHidInitResult::CoreInitFailed;
    if(USBD_RegisterClass(&usb_device, &hid_class) != USBD_OK)
    {
        USBD_DeInit(&usb_device);
        return UsbHidInitResult::ClassRegistrationFailed;
    }
    if(USBD_Start(&usb_device) != USBD_OK)
    {
        USBD_DeInit(&usb_device);
        return UsbHidInitResult::DeviceStartFailed;
    }
    return UsbHidInitResult::Ready;
}

void UsbHidStop()
{
    USBD_Stop(&usb_device);
    USBD_DeInit(&usb_device);
    state.configured = false;
}

uint32_t UsbHidGeneration() { return state.generation; }

bool UsbHidConfigured() { return state.configured; }

bool UsbHidAddressedUnconfigured()
{
    const uint8_t dev_state = usb_device.dev_state;
    const uint8_t old_state = usb_device.dev_old_state;
    return !state.configured
           && (dev_state == USBD_STATE_ADDRESSED
               || (dev_state == USBD_STATE_SUSPENDED
                   && old_state == USBD_STATE_ADDRESSED));
}

bool UsbHidCanSend()
{
    return state.configured && !state.tx_busy
           && usb_device.dev_state == USBD_STATE_CONFIGURED;
}

bool UsbHidSend(const uint8_t report[kReportSize])
{
    IrqGuard guard;
    if(!UsbHidCanSend())
        return false;
    std::memcpy(tx_packet, report, kReportSize);
    state.tx_busy = true;
    if(USBD_LL_Transmit(&usb_device, kHidInEndpoint, tx_packet, kReportSize)
       != USBD_OK)
    {
        state.tx_busy = false;
        return false;
    }
    return true;
}

bool UsbHidReceive(uint8_t report[kReportSize], size_t* length)
{
    const uint32_t tail = rx_tail;
    if(tail == rx_head)
        return false;
    __DMB();
    std::memset(report, 0, kReportSize);
    *length = rx_length[tail % kRxSlots];
    std::memcpy(report, rx_ring[tail % kRxSlots], *length);
    __DMB();
    rx_tail = tail + 1;
    return true;
}

uint32_t UsbHidRxDropped() { return state.rx_dropped; }

} // namespace hw
} // namespace agentctl
