// Protocol tests against packages/chompi-protocol/fixtures/v1.json.
#include <cstring>
#include <set>
#include <string>
#include <vector>

#include "core/protocol.h"
#include "json.h"
#include "test.h"

using namespace agentctl;

namespace
{
std::vector<uint8_t> FromHex(const std::string& hex)
{
    std::vector<uint8_t> out;
    for(size_t i = 0; i + 1 < hex.size(); i += 2)
        out.push_back(static_cast<uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    return out;
}

const json::Value& Fixtures()
{
    static const json::Value doc = json::ParseFile(testing::FixturePath());
    return doc;
}

const char* KindName(InputKind kind)
{
    switch(kind)
    {
        case InputKind::Press: return "press";
        case InputKind::Release: return "release";
        case InputKind::Turn: return "turn";
    }
    return "?";
}

const char* TypeName(MessageType type)
{
    switch(type)
    {
        case MessageType::Hello: return "hello";
        case MessageType::Input: return "input";
        case MessageType::Heartbeat: return "heartbeat";
        case MessageType::Leds: return "leds";
        case MessageType::HostHeartbeat: return "host-heartbeat";
    }
    return "?";
}

bool DeviceToHost(MessageType type)
{
    return type == MessageType::Hello || type == MessageType::Input
           || type == MessageType::Heartbeat;
}

// Checks every field of the fixture's decoded message, then re-encodes.
void CheckValidVector(const json::Value& v, const std::vector<uint8_t>& report)
{
    Message msg{};
    const Reason reason = Decode(report.data(), report.size(), &msg);
    CHECK_EQ(std::string(ReasonName(reason)), std::string("ok"));
    if(reason != Reason::Ok)
        return;

    const json::Value& m = v["message"];
    CHECK_EQ(std::string(TypeName(msg.type)), m["type"].string);
    CHECK_EQ(m["version"].number, static_cast<int64_t>(kProtocolVersion));
    CHECK_EQ(std::string(DeviceToHost(msg.type) ? "device-to-host"
                                                : "host-to-device"),
             v["direction"].string);

    uint8_t encoded[kReportSize];
    std::memset(encoded, 0xEE, sizeof(encoded));
    switch(msg.type)
    {
        case MessageType::Hello:
            CHECK_EQ(msg.hello.epoch, m["epoch"].number);
            for(size_t i = 0; i < 3; ++i)
                CHECK_EQ(msg.hello.firmware[i], m["firmware"][i].number);
            CHECK_EQ(msg.hello.controls, m["controls"].number);
            CHECK_EQ(msg.hello.encoders, m["encoders"].number);
            CHECK_EQ(msg.hello.leds, m["leds"].number);
            EncodeHello(msg.hello, encoded);
            break;
        case MessageType::Input:
            CHECK_EQ(msg.input.epoch, m["epoch"].number);
            CHECK_EQ(msg.input.sequence, m["sequence"].number);
            CHECK_EQ(msg.input.control, m["control"].number);
            CHECK_EQ(std::string(KindName(msg.input.kind)), m["kind"].string);
            CHECK_EQ(msg.input.delta, m["delta"].number);
            EncodeInput(msg.input, encoded);
            break;
        case MessageType::Heartbeat:
            CHECK_EQ(msg.heartbeat.epoch, m["epoch"].number);
            CHECK_EQ(msg.heartbeat.led_frame, m["ledFrame"].number);
            CHECK_EQ(msg.heartbeat.host_alive, m["hostAlive"].boolean);
            EncodeHeartbeat(msg.heartbeat, encoded);
            break;
        case MessageType::Leds:
        {
            CHECK_EQ(msg.leds.frame, m["frame"].number);
            CHECK_EQ(msg.leds.part, m["part"].number);
            CHECK_EQ(LedsPartFirst(msg.leds.part), m["first"].number);
            const json::Value& colors = m["colors"];
            REQUIRE(static_cast<size_t>(msg.leds.count) == colors.size());
            for(size_t i = 0; i < colors.size(); ++i)
            {
                CHECK_EQ(msg.leds.colors[i].r, colors[i][0].number);
                CHECK_EQ(msg.leds.colors[i].g, colors[i][1].number);
                CHECK_EQ(msg.leds.colors[i].b, colors[i][2].number);
            }
            EncodeLeds(msg.leds, encoded);
            break;
        }
        case MessageType::HostHeartbeat:
            CHECK_EQ(msg.host_heartbeat.profile_version,
                     m["profileVersion"].number);
            CHECK_EQ(msg.host_heartbeat.brightness_percent,
                     m["brightnessPercent"].number);
            EncodeHostHeartbeat(msg.host_heartbeat, encoded);
            break;
    }
    REQUIRE(report.size() == kReportSize);
    CHECK(std::memcmp(encoded, report.data(), kReportSize) == 0);
}

std::vector<uint8_t> Report(std::initializer_list<uint8_t> head)
{
    std::vector<uint8_t> r(kReportSize, 0);
    size_t               i = 0;
    for(uint8_t b : head)
        r[i++] = b;
    return r;
}

Reason DecodeVec(const std::vector<uint8_t>& r)
{
    Message msg{};
    return Decode(r.data(), r.size(), &msg);
}
} // namespace

TEST("fixtures: header matches protocol constants")
{
    const json::Value& doc = Fixtures();
    CHECK_EQ(doc["protocol"].string, std::string("chompi-hid"));
    CHECK_EQ(doc["version"].number, static_cast<int64_t>(kProtocolVersion));
    CHECK_EQ(doc["reportBytes"].number, static_cast<int64_t>(kReportSize));
    CHECK(doc["vectors"].size() > 0);
}

TEST("fixtures: every valid vector decodes and round-trips")
{
    int valid = 0;
    for(const json::Value& v : Fixtures()["vectors"].array)
    {
        if(!v["valid"].boolean)
            continue;
        ++valid;
        std::fprintf(stdout, "    vector: %s\n", v["name"].string.c_str());
        CheckValidVector(v, FromHex(v["report"].string));
    }
    CHECK(valid >= 10);
}

TEST("fixtures: every invalid vector is rejected with its reason")
{
    std::set<std::string> seen;
    int                   invalid = 0;
    for(const json::Value& v : Fixtures()["vectors"].array)
    {
        if(v["valid"].boolean)
            continue;
        ++invalid;
        const std::vector<uint8_t> report = FromHex(v["report"].string);
        Message                    msg{};
        msg.type            = MessageType::Hello;
        msg.hello.epoch     = 0xBEEF;
        const Reason reason = Decode(report.data(), report.size(), &msg);
        std::fprintf(stdout, "    vector: %s -> %s\n", v["name"].string.c_str(),
                     ReasonName(reason));
        CHECK_EQ(std::string(ReasonName(reason)), v["reason"].string);
        // A rejected report leaves the output untouched.
        CHECK_EQ(msg.hello.epoch, 0xBEEF);
        seen.insert(v["reason"].string);
    }
    CHECK(invalid >= 9);
    for(const char* name :
        {"unknown-type", "unsupported-version", "invalid-length",
         "invalid-control", "invalid-kind", "invalid-delta",
         "invalid-led-range", "invalid-brightness", "incompatible-device"})
        CHECK(seen.count(name) == 1);
}

TEST("protocol: version mismatch is rejected for every message type")
{
    for(int type : {0x01, 0x02, 0x03, 0x81, 0x82})
    {
        for(int version : {0, 2, 255})
            CHECK(DecodeVec(Report({static_cast<uint8_t>(type),
                                    static_cast<uint8_t>(version)}))
                  == Reason::UnsupportedVersion);
    }
}

TEST("protocol: reports must be exactly 64 bytes")
{
    std::vector<uint8_t> hb = Report({0x82, 0x01, 0x01, 0, 0, 0, 50});
    CHECK(DecodeVec(hb) == Reason::Ok);
    hb.push_back(0);
    CHECK(DecodeVec(hb) == Reason::InvalidLength);
    hb.resize(63);
    CHECK(DecodeVec(hb) == Reason::InvalidLength);
    Message msg{};
    CHECK(Decode(nullptr, 0, &msg) == Reason::InvalidLength);
}

TEST("protocol: unused bytes are ignored")
{
    std::vector<uint8_t> hb = Report({0x82, 0x01, 0x07, 0, 0, 0, 100});
    hb[63] = 0xFF;
    hb[20] = 0x55;
    Message msg{};
    REQUIRE(Decode(hb.data(), hb.size(), &msg) == Reason::Ok);
    CHECK_EQ(msg.host_heartbeat.profile_version, 7u);
    CHECK_EQ(msg.host_heartbeat.brightness_percent, 100);
}

TEST("protocol: input control and kind validation")
{
    // control, kind, delta -> expected
    struct Case
    {
        uint8_t control, kind;
        int8_t  delta;
        Reason  expected;
    };
    const Case cases[] = {
        {1, 1, 0, Reason::Ok},
        {28, 2, 0, Reason::Ok},
        {34, 1, 0, Reason::Ok},
        {41, 3, 1, Reason::Ok},
        {46, 3, -127, Reason::Ok},
        {0, 1, 0, Reason::InvalidControl},
        {35, 1, 0, Reason::InvalidControl},
        {40, 3, 1, Reason::InvalidControl},
        {47, 3, 1, Reason::InvalidControl},
        {255, 1, 0, Reason::InvalidControl},
        {1, 0, 0, Reason::InvalidKind},
        {1, 4, 0, Reason::InvalidKind},
        {41, 1, 0, Reason::InvalidKind}, // press on a turn ID
        {29, 3, 1, Reason::InvalidKind}, // turn on a click ID
        {1, 2, 5, Reason::InvalidDelta},
        {42, 3, 0, Reason::InvalidDelta},
    };
    for(const Case& c : cases)
    {
        const auto r = Report({0x02, 0x01, 0x01, 0x00, 0x01, 0x00, c.control,
                               c.kind, static_cast<uint8_t>(c.delta)});
        CHECK_EQ(std::string(ReasonName(DecodeVec(r))),
                 std::string(ReasonName(c.expected)));
    }
}

TEST("protocol: light frame part validation")
{
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 0, 19})) == Reason::Ok);
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 1, 16})) == Reason::Ok);
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 0, 16})) == Reason::InvalidLedRange);
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 1, 19})) == Reason::InvalidLedRange);
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 0, 0})) == Reason::InvalidLedRange);
    CHECK(DecodeVec(Report({0x81, 0x01, 0, 0, 3, 16})) == Reason::InvalidLedRange);
}

TEST("protocol: host heartbeat brightness range")
{
    CHECK(DecodeVec(Report({0x82, 0x01, 0, 0, 0, 0, 0})) == Reason::Ok);
    CHECK(DecodeVec(Report({0x82, 0x01, 0, 0, 0, 0, 100})) == Reason::Ok);
    CHECK(DecodeVec(Report({0x82, 0x01, 0, 0, 0, 0, 101})) == Reason::InvalidBrightness);
    CHECK(DecodeVec(Report({0x82, 0x01, 0, 0, 0, 0, 255})) == Reason::InvalidBrightness);
}

TEST("protocol: hello counts must match this device")
{
    CHECK(DecodeVec(Report({0x01, 0x01, 1, 0, 0, 1, 0, 34, 6, 35})) == Reason::Ok);
    CHECK(DecodeVec(Report({0x01, 0x01, 1, 0, 0, 1, 0, 33, 6, 35}))
          == Reason::IncompatibleDevice);
    CHECK(DecodeVec(Report({0x01, 0x01, 1, 0, 0, 1, 0, 34, 5, 35}))
          == Reason::IncompatibleDevice);
}

TEST("protocol: the firmware hello matches the fixture identity")
{
    const HelloMsg hello = MakeHello(0x1234);
    uint8_t        out[kReportSize];
    EncodeHello(hello, out);
    for(const json::Value& v : Fixtures()["vectors"].array)
    {
        if(v["name"].string == "hello")
        {
            const std::vector<uint8_t> expected = FromHex(v["report"].string);
            CHECK(std::memcmp(out, expected.data(), kReportSize) == 0);
        }
    }
}

TEST("protocol: control ID helpers")
{
    CHECK_EQ(ClickControlForEncoder(1), 29);
    CHECK_EQ(ClickControlForEncoder(6), 34);
    CHECK_EQ(TurnControlForEncoder(1), 41);
    CHECK_EQ(TurnControlForEncoder(5), 45);
    CHECK(IsButtonControl(1) && IsButtonControl(34) && !IsButtonControl(35));
    CHECK(IsTurnControl(41) && IsTurnControl(46) && !IsTurnControl(40)
          && !IsTurnControl(47));
    CHECK(!IsValidControl(0) && !IsValidControl(38));
    CHECK_EQ(LedsPartFirst(1), 19);
    CHECK_EQ(LedsPartCount(0), 19);
    CHECK_EQ(LedsPartCount(1), 16);
    CHECK_EQ(LedsPartCount(2), 0);
}
