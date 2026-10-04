// CHOMPI HID protocol version 1: report encoding and validation.
//
// The contract lives in packages/chompi-protocol/README.md and
// packages/chompi-protocol/fixtures/v1.json. This module has no hardware
// dependency so host tests can check it against the shared fixtures.
#pragma once

#include <cstddef>
#include <cstdint>

namespace agentctl
{

constexpr size_t  kReportSize      = 64;
constexpr uint8_t kProtocolVersion = 1;

constexpr uint8_t kControlCount = 34;
constexpr uint8_t kEncoderCount = 6;
constexpr uint8_t kLedCount     = 35;

constexpr uint8_t kFirmwareMajor = 0;
constexpr uint8_t kFirmwareMinor = 1;
constexpr uint8_t kFirmwarePatch = 0;

// Control IDs. 1-28 are keys, 29-34 encoder clicks, 41-46 encoder turns.
constexpr uint8_t kFirstClickId = 29;
constexpr uint8_t kFirstTurnId  = 41;
constexpr uint8_t kLastTurnId   = 46;

// A light frame is split across two reports.
constexpr uint8_t kLedsPart0Count = 19;
constexpr uint8_t kLedsPart1Count = 16;
constexpr uint8_t kMaxLedsPerPart = kLedsPart0Count;

enum class MessageType : uint8_t
{
    Hello         = 0x01,
    Input         = 0x02,
    Heartbeat     = 0x03,
    Leds          = 0x81,
    HostHeartbeat = 0x82,
};

enum class InputKind : uint8_t
{
    Press   = 1,
    Release = 2,
    Turn    = 3,
};

// Rejection reasons. The names match the fixture strings.
enum class Reason : uint8_t
{
    Ok,
    UnknownType,
    UnsupportedVersion,
    InvalidLength,
    InvalidControl,
    InvalidKind,
    InvalidDelta,
    InvalidLedRange,
    InvalidBrightness,
    IncompatibleDevice,
};

const char* ReasonName(Reason reason);

struct Rgb
{
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

struct HelloMsg
{
    uint16_t epoch;
    uint8_t  firmware[3];
    uint8_t  controls;
    uint8_t  encoders;
    uint8_t  leds;
};

struct InputMsg
{
    uint16_t  epoch;
    uint16_t  sequence;
    uint8_t   control;
    InputKind kind;
    int8_t    delta;
};

struct HeartbeatMsg
{
    uint16_t epoch;
    uint16_t led_frame;
    bool     host_alive;
};

struct LedsMsg
{
    uint16_t frame;
    uint8_t  part;
    uint8_t  count;
    Rgb      colors[kMaxLedsPerPart];
};

struct HostHeartbeatMsg
{
    uint32_t profile_version;
    uint8_t  brightness_percent;
};

// A decoded report. Only the member matching `type` is meaningful.
struct Message
{
    MessageType      type;
    HelloMsg         hello;
    InputMsg         input;
    HeartbeatMsg     heartbeat;
    LedsMsg          leds;
    HostHeartbeatMsg host_heartbeat;
};

bool IsButtonControl(uint8_t control);
bool IsTurnControl(uint8_t control);
bool IsValidControl(uint8_t control);

// Encoder numbers follow the firmware: 1-6 for ENC_1-ENC_6.
uint8_t ClickControlForEncoder(uint8_t encoder);
uint8_t TurnControlForEncoder(uint8_t encoder);

// First LED index carried by a light-frame part (0 or 19).
uint8_t LedsPartFirst(uint8_t part);
// LEDs carried by a light-frame part (19 or 16), 0 for an invalid part.
uint8_t LedsPartCount(uint8_t part);

// Validates and decodes one report of either direction. `out` is written only
// when the result is Reason::Ok.
Reason Decode(const uint8_t* data, size_t length, Message* out);

// Encoders write a full report, zero-filling unused bytes.
void EncodeHello(const HelloMsg& msg, uint8_t out[kReportSize]);
void EncodeInput(const InputMsg& msg, uint8_t out[kReportSize]);
void EncodeHeartbeat(const HeartbeatMsg& msg, uint8_t out[kReportSize]);
void EncodeLeds(const LedsMsg& msg, uint8_t out[kReportSize]);
void EncodeHostHeartbeat(const HostHeartbeatMsg& msg,
                         uint8_t                 out[kReportSize]);

// The hello this firmware sends for an epoch.
HelloMsg MakeHello(uint16_t epoch);

} // namespace agentctl
