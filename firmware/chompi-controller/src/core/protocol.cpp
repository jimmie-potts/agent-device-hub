#include "protocol.h"

#include <cstring>

namespace agentctl
{
namespace
{
uint16_t ReadU16(const uint8_t* p)
{
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

uint32_t ReadU32(const uint8_t* p)
{
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8)
           | (static_cast<uint32_t>(p[2]) << 16)
           | (static_cast<uint32_t>(p[3]) << 24);
}

void WriteU16(uint8_t* p, uint16_t v)
{
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
}

void WriteU32(uint8_t* p, uint32_t v)
{
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
    p[2] = static_cast<uint8_t>(v >> 16);
    p[3] = static_cast<uint8_t>(v >> 24);
}

void Begin(MessageType type, uint8_t out[kReportSize])
{
    std::memset(out, 0, kReportSize);
    out[0] = static_cast<uint8_t>(type);
    out[1] = kProtocolVersion;
}

bool KnownType(uint8_t type)
{
    switch(static_cast<MessageType>(type))
    {
        case MessageType::Hello:
        case MessageType::Input:
        case MessageType::Heartbeat:
        case MessageType::Leds:
        case MessageType::HostHeartbeat: return true;
    }
    return false;
}

Reason DecodeInput(const uint8_t* d, InputMsg* m)
{
    const uint8_t control = d[6];
    const uint8_t kind    = d[7];
    const int8_t  delta   = static_cast<int8_t>(d[8]);

    if(!IsValidControl(control))
        return Reason::InvalidControl;
    if(kind < static_cast<uint8_t>(InputKind::Press)
       || kind > static_cast<uint8_t>(InputKind::Turn))
        return Reason::InvalidKind;

    const bool turn = kind == static_cast<uint8_t>(InputKind::Turn);
    if(turn != IsTurnControl(control))
        return Reason::InvalidKind;
    if(turn ? delta == 0 : delta != 0)
        return Reason::InvalidDelta;

    m->epoch    = ReadU16(d + 2);
    m->sequence = ReadU16(d + 4);
    m->control  = control;
    m->kind     = static_cast<InputKind>(kind);
    m->delta    = delta;
    return Reason::Ok;
}

Reason DecodeLeds(const uint8_t* d, LedsMsg* m)
{
    const uint8_t part  = d[4];
    const uint8_t count = d[5];
    if(LedsPartCount(part) == 0 || count != LedsPartCount(part))
        return Reason::InvalidLedRange;

    m->frame = ReadU16(d + 2);
    m->part  = part;
    m->count = count;
    for(uint8_t i = 0; i < count; ++i)
    {
        const uint8_t* c = d + 6 + 3 * i;
        m->colors[i]     = Rgb{c[0], c[1], c[2]};
    }
    return Reason::Ok;
}
} // namespace

const char* ReasonName(Reason reason)
{
    switch(reason)
    {
        case Reason::Ok: return "ok";
        case Reason::UnknownType: return "unknown-type";
        case Reason::UnsupportedVersion: return "unsupported-version";
        case Reason::InvalidLength: return "invalid-length";
        case Reason::InvalidControl: return "invalid-control";
        case Reason::InvalidKind: return "invalid-kind";
        case Reason::InvalidDelta: return "invalid-delta";
        case Reason::InvalidLedRange: return "invalid-led-range";
        case Reason::InvalidBrightness: return "invalid-brightness";
        case Reason::IncompatibleDevice: return "incompatible-device";
    }
    return "unknown";
}

bool IsButtonControl(uint8_t control)
{
    return control >= 1 && control <= kControlCount;
}

bool IsTurnControl(uint8_t control)
{
    return control >= kFirstTurnId && control <= kLastTurnId;
}

bool IsValidControl(uint8_t control)
{
    return IsButtonControl(control) || IsTurnControl(control);
}

uint8_t ClickControlForEncoder(uint8_t encoder)
{
    return static_cast<uint8_t>(kFirstClickId + encoder - 1);
}

uint8_t TurnControlForEncoder(uint8_t encoder)
{
    return static_cast<uint8_t>(kFirstTurnId + encoder - 1);
}

uint8_t LedsPartFirst(uint8_t part) { return part == 1 ? kLedsPart0Count : 0; }

uint8_t LedsPartCount(uint8_t part)
{
    return part == 0 ? kLedsPart0Count : (part == 1 ? kLedsPart1Count : 0);
}

Reason Decode(const uint8_t* d, size_t length, Message* out)
{
    // Precedence is normative: length, version, type, then fields.
    if(d == nullptr || length != kReportSize)
        return Reason::InvalidLength;
    if(d[1] != kProtocolVersion)
        return Reason::UnsupportedVersion;
    if(!KnownType(d[0]))
        return Reason::UnknownType;

    Message      m{};
    Reason       result = Reason::Ok;
    m.type              = static_cast<MessageType>(d[0]);
    switch(m.type)
    {
        case MessageType::Hello:
            // Epoch 0 is never valid; other counts mean another device.
            if(ReadU16(d + 2) == 0 || d[7] != kControlCount
               || d[8] != kEncoderCount || d[9] != kLedCount)
                return Reason::IncompatibleDevice;
            m.hello.epoch       = ReadU16(d + 2);
            m.hello.firmware[0] = d[4];
            m.hello.firmware[1] = d[5];
            m.hello.firmware[2] = d[6];
            m.hello.controls    = d[7];
            m.hello.encoders    = d[8];
            m.hello.leds        = d[9];
            break;
        case MessageType::Input: result = DecodeInput(d, &m.input); break;
        case MessageType::Heartbeat:
            m.heartbeat.epoch      = ReadU16(d + 2);
            m.heartbeat.led_frame  = ReadU16(d + 4);
            m.heartbeat.host_alive = (d[6] & 0x01) != 0;
            break;
        case MessageType::Leds: result = DecodeLeds(d, &m.leds); break;
        case MessageType::HostHeartbeat:
            if(d[6] > 100)
                return Reason::InvalidBrightness;
            m.host_heartbeat.profile_version    = ReadU32(d + 2);
            m.host_heartbeat.brightness_percent = d[6];
            break;
    }
    if(result == Reason::Ok && out != nullptr)
        *out = m;
    return result;
}

void EncodeHello(const HelloMsg& msg, uint8_t out[kReportSize])
{
    Begin(MessageType::Hello, out);
    WriteU16(out + 2, msg.epoch);
    out[4] = msg.firmware[0];
    out[5] = msg.firmware[1];
    out[6] = msg.firmware[2];
    out[7] = msg.controls;
    out[8] = msg.encoders;
    out[9] = msg.leds;
}

void EncodeInput(const InputMsg& msg, uint8_t out[kReportSize])
{
    Begin(MessageType::Input, out);
    WriteU16(out + 2, msg.epoch);
    WriteU16(out + 4, msg.sequence);
    out[6] = msg.control;
    out[7] = static_cast<uint8_t>(msg.kind);
    out[8] = static_cast<uint8_t>(msg.delta);
}

void EncodeHeartbeat(const HeartbeatMsg& msg, uint8_t out[kReportSize])
{
    Begin(MessageType::Heartbeat, out);
    WriteU16(out + 2, msg.epoch);
    WriteU16(out + 4, msg.led_frame);
    out[6] = msg.host_alive ? 0x01 : 0x00;
}

void EncodeLeds(const LedsMsg& msg, uint8_t out[kReportSize])
{
    Begin(MessageType::Leds, out);
    WriteU16(out + 2, msg.frame);
    out[4]              = msg.part;
    const uint8_t count = msg.count > kMaxLedsPerPart ? kMaxLedsPerPart : msg.count;
    out[5]              = count;
    for(uint8_t i = 0; i < count; ++i)
    {
        out[6 + 3 * i]     = msg.colors[i].r;
        out[6 + 3 * i + 1] = msg.colors[i].g;
        out[6 + 3 * i + 2] = msg.colors[i].b;
    }
}

void EncodeHostHeartbeat(const HostHeartbeatMsg& msg, uint8_t out[kReportSize])
{
    Begin(MessageType::HostHeartbeat, out);
    WriteU32(out + 2, msg.profile_version);
    out[6] = msg.brightness_percent;
}

HelloMsg MakeHello(uint16_t epoch)
{
    HelloMsg h{};
    h.epoch       = epoch;
    h.firmware[0] = kFirmwareMajor;
    h.firmware[1] = kFirmwareMinor;
    h.firmware[2] = kFirmwarePatch;
    h.controls    = kControlCount;
    h.encoders    = kEncoderCount;
    h.leds        = kLedCount;
    return h;
}

} // namespace agentctl
