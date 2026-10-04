// Session tests with a fake host: epochs, liveness, queueing, connection loss
// and light frames.
#include <cstring>
#include <string>
#include <vector>

#include "core/controller.h"
#include "core/protocol.h"
#include "json.h"
#include "test.h"

using namespace agentctl;

namespace
{
constexpr uint64_t Bit(uint8_t control) { return uint64_t{1} << (control - 1); }

struct FakeHost
{
    Controller           c;
    uint32_t             now  = 1000;
    uint64_t             down = 0;
    std::vector<Message> received;

    void Enumerate(uint16_t epoch) { c.OnUsbConfigured(epoch, now); }

    Reason Send(const uint8_t* report) { return c.OnHostReport(report, kReportSize, now); }

    void Beat(uint8_t brightness = 100, uint32_t profile = 1)
    {
        uint8_t r[kReportSize];
        EncodeHostHeartbeat(HostHeartbeatMsg{profile, brightness}, r);
        REQUIRE(Send(r) == Reason::Ok);
    }

    void SendLeds(uint16_t frame, uint8_t part, const Rgb* colors)
    {
        LedsMsg msg{};
        msg.frame = frame;
        msg.part  = part;
        msg.count = LedsPartCount(part);
        std::memcpy(msg.colors, colors, msg.count * sizeof(Rgb));
        uint8_t r[kReportSize];
        EncodeLeds(msg, r);
        REQUIRE(Send(r) == Reason::Ok);
    }

    void Press(uint8_t control)
    {
        down |= Bit(control);
        c.OnInput(InputEvent{control, InputKind::Press, 0});
    }

    void Release(uint8_t control)
    {
        down &= ~Bit(control);
        c.OnInput(InputEvent{control, InputKind::Release, 0});
    }

    void Turn(uint8_t control, int8_t delta)
    {
        c.OnInput(InputEvent{control, InputKind::Turn, delta});
    }

    // Reads every report the device has ready, as the host would.
    void Drain()
    {
        c.Update(now, down);
        uint8_t r[kReportSize];
        while(c.NextReport(r))
        {
            Message m{};
            REQUIRE(Decode(r, kReportSize, &m) == Reason::Ok);
            received.push_back(m);
        }
    }

    // Advances time in 1 ms steps, draining after each step.
    void Run(uint32_t ms, bool beat_every_500 = false)
    {
        for(uint32_t i = 0; i < ms; ++i)
        {
            ++now;
            if(beat_every_500 && now % 500 == 0)
                Beat();
            Drain();
        }
    }

    // Brings up a session with a live host and clears the log.
    void Connect(uint16_t epoch = 0x1234)
    {
        Enumerate(epoch);
        Drain();
        Beat();
        Drain();
        received.clear();
    }

    std::vector<Message> Of(MessageType type) const
    {
        std::vector<Message> out;
        for(const Message& m : received)
            if(m.type == type)
                out.push_back(m);
        return out;
    }
};

bool AllOff(const ChainFrame& f)
{
    for(const auto& k : f.keys)
        if(k[0] || k[1] || k[2])
            return false;
    for(const auto& p : f.panel)
        if(p[0] || p[1] || p[2])
            return false;
    return true;
}

bool SameFrame(const ChainFrame& a, const ChainFrame& b)
{
    return std::memcmp(&a, &b, sizeof(ChainFrame)) == 0;
}
} // namespace

TEST("session: nothing is sent before enumeration")
{
    FakeHost h;
    h.c.Reset();
    h.Press(1);
    h.Run(2000);
    CHECK(h.received.empty());
    CHECK(!h.c.configured());
}

TEST("session: hello on the first host heartbeat after enumeration")
{
    FakeHost h;
    h.Enumerate(0x1234);
    h.Run(2600); // no handle open yet: no hello, only heartbeats
    CHECK(h.Of(MessageType::Hello).empty());
    CHECK(!h.Of(MessageType::Heartbeat).empty());
    h.received.clear();
    h.Beat();
    h.Drain();
    REQUIRE(!h.received.empty());
    CHECK(h.received[0].type == MessageType::Hello);
    CHECK_EQ(h.received[0].hello.epoch, 0x1234);
    CHECK_EQ(h.received[0].hello.controls, kControlCount);
    CHECK_EQ(h.received[0].hello.encoders, kEncoderCount);
    CHECK_EQ(h.received[0].hello.leds, kLedCount);
    CHECK_EQ(h.received[0].hello.firmware[1], kFirmwareMinor);
    // Further heartbeats in the same session bring no more hellos.
    h.Run(1600, true);
    CHECK_EQ(h.Of(MessageType::Hello).size(), 1u);
}

TEST("session: every enumeration has its own nonzero epoch")
{
    FakeHost h;
    h.Connect(0x1111);
    h.c.OnUsbDeconfigured();
    h.Run(100);
    CHECK(h.received.empty());
    h.Enumerate(0x7777);
    h.Beat();
    h.Drain();
    REQUIRE(!h.received.empty());
    CHECK(h.received[0].type == MessageType::Hello);
    CHECK_EQ(h.received[0].hello.epoch, 0x7777);
    CHECK_EQ(h.c.epoch(), 0x7777);
    h.c.OnUsbDeconfigured();
    h.Enumerate(0);
    CHECK(h.c.epoch() != 0);
}

TEST("session: hello again after a timeout and resumed heartbeats")
{
    FakeHost h;
    h.Connect(0x2222);
    h.Run(2500); // bridge restarted: heartbeats stop for 2.5 s
    CHECK(!h.c.connected());
    CHECK(h.Of(MessageType::Hello).empty());
    h.received.clear();
    h.Beat(); // the new bridge starts heartbeating
    h.Run(1600, true);
    const std::vector<Message> hellos = h.Of(MessageType::Hello);
    REQUIRE(hellos.size() == 1);
    CHECK(h.received[0].type == MessageType::Hello);
    CHECK_EQ(hellos[0].hello.epoch, 0x2222); // same epoch across a timeout
    CHECK(h.c.connected());
}

TEST("session: no input goes out before the session's hello")
{
    FakeHost h;
    h.Enumerate(0x3333);
    h.Drain();
    h.Beat();
    h.c.Update(h.now, h.down); // session starts
    h.Press(5);                // input in the same pass, before any send
    h.Turn(41, 1);
    uint8_t r[kReportSize];
    std::vector<Message> out;
    while(h.c.NextReport(r))
    {
        Message m{};
        REQUIRE(Decode(r, kReportSize, &m) == Reason::Ok);
        out.push_back(m);
    }
    REQUIRE(out.size() == 3);
    CHECK(out[0].type == MessageType::Hello);
    CHECK(out[1].type == MessageType::Input);
    CHECK_EQ(out[1].input.sequence, 1);
    CHECK(out[2].type == MessageType::Input);

    // After a timeout, the next session again starts with hello.
    h.now += Controller::kHostTimeoutMs;
    h.c.Update(h.now, h.down);
    h.Beat();
    h.c.Update(h.now, h.down);
    h.Press(6);
    REQUIRE(h.c.NextReport(r));
    Message first{};
    REQUIRE(Decode(r, kReportSize, &first) == Reason::Ok);
    CHECK(first.type == MessageType::Hello);
}

TEST("session: heartbeat every 500 ms reports host liveness")
{
    FakeHost h;
    h.Enumerate(0x1234);
    h.Run(2000);
    std::vector<Message> beats = h.Of(MessageType::Heartbeat);
    CHECK_EQ(beats.size(), 4u);
    for(const Message& m : beats)
    {
        CHECK_EQ(m.heartbeat.epoch, 0x1234);
        CHECK(!m.heartbeat.host_alive);
    }
    h.received.clear();
    h.Beat();
    h.Run(1000, true);
    beats = h.Of(MessageType::Heartbeat);
    CHECK_EQ(beats.size(), 2u);
    for(const Message& m : beats)
        CHECK(m.heartbeat.host_alive);
}

TEST("session: input is not queued until a host heartbeat arrives")
{
    FakeHost h;
    h.Enumerate(0x1234);
    h.Drain();
    h.Press(3);
    h.Turn(41, 1);
    h.Release(3);
    CHECK_EQ(h.c.queued(), 0u);
    h.Run(10);
    CHECK(h.Of(MessageType::Input).empty());
    h.Beat();
    h.Drain();
    h.Press(4);
    h.Drain();
    const std::vector<Message> inputs = h.Of(MessageType::Input);
    REQUIRE(inputs.size() == 1);
    CHECK_EQ(inputs[0].input.control, 4);
}

TEST("session: input carries epoch and sequence from 1")
{
    FakeHost h;
    h.Connect(0x4321);
    h.Press(1);
    h.Release(1);
    h.Turn(45, -1);
    h.Press(33);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == 4);
    for(size_t i = 0; i < in.size(); ++i)
    {
        CHECK_EQ(in[i].input.epoch, 0x4321);
        CHECK_EQ(in[i].input.sequence, i + 1);
    }
    CHECK(in[0].input.kind == InputKind::Press);
    CHECK(in[1].input.kind == InputKind::Release);
    CHECK(in[2].input.kind == InputKind::Turn);
    CHECK_EQ(in[2].input.delta, -1);
    CHECK_EQ(in[3].input.control, 33);
}

TEST("session: queued turns of one encoder coalesce")
{
    FakeHost h;
    h.Connect();
    for(int i = 0; i < 5; ++i)
        h.Turn(41, 1);
    h.Turn(41, -1);
    h.Turn(42, 1);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == 3);
    CHECK_EQ(in[0].input.delta, 5);
    CHECK_EQ(in[1].input.delta, -1);
    CHECK_EQ(in[2].input.control, 42);
}

TEST("session: sequence wraps from 65535 to 1")
{
    FakeHost h;
    h.Connect();
    uint8_t r[kReportSize];
    h.c.Update(h.now, 0);
    while(h.c.NextReport(r))
    {
    }
    uint16_t last = 0;
    for(uint32_t i = 0; i < 65536; ++i)
    {
        h.c.OnInput(InputEvent{static_cast<uint8_t>(i % 2 ? 41 : 42),
                               InputKind::Turn, 1});
        REQUIRE(h.c.NextReport(r));
        Message m{};
        REQUIRE(Decode(r, kReportSize, &m) == Reason::Ok);
        REQUIRE(m.type == MessageType::Input);
        last = m.input.sequence;
        if(i == 65534)
            CHECK_EQ(last, 65535);
    }
    CHECK_EQ(last, 1);
}

TEST("session: queue overflow is bounded and drops the oldest")
{
    FakeHost h;
    h.Connect();
    // The host stops reading; 40 turns alternate encoders so none merge.
    for(int i = 0; i < 40; ++i)
        h.Turn(static_cast<uint8_t>(41 + (i % 2)), 1);
    CHECK_EQ(h.c.queued(), EventQueue::kCapacity);
    CHECK_EQ(h.c.dropped(), 8u);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == EventQueue::kCapacity);
    CHECK_EQ(in[0].input.sequence, 9); // 1-8 were dropped
}

TEST("session: a release lost to overflow is resent for a key that is up")
{
    FakeHost h;
    h.Connect();
    h.Press(7);
    h.Drain(); // the host saw key 7 go down
    h.received.clear();
    h.Release(7);
    for(int i = 0; i < 40; ++i) // the release is pushed out of the queue
        h.Turn(static_cast<uint8_t>(41 + (i % 2)), 1);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(!in.empty());
    const Message& last = in.back();
    CHECK_EQ(last.input.control, 7);
    CHECK(last.input.kind == InputKind::Release);
    int releases = 0;
    for(const Message& m : in)
        if(m.input.control == 7)
            ++releases;
    CHECK_EQ(releases, 1);
}

TEST("session: a press lost to overflow is not answered with a fake release")
{
    FakeHost h;
    h.Connect();
    h.Press(9);
    for(int i = 0; i < 40; ++i)
        h.Turn(static_cast<uint8_t>(41 + (i % 2)), 1);
    h.Drain();
    for(const Message& m : h.Of(MessageType::Input))
        CHECK(m.input.control != 9);
    h.received.clear();
    h.Release(9); // the real release still goes out; the bridge ignores it
    h.Drain();
    REQUIRE(h.Of(MessageType::Input).size() == 1);
}

TEST("session: host heartbeat timeout disconnects after 2 s")
{
    FakeHost h;
    h.Connect();
    h.Run(1999);
    CHECK(h.c.connected());
    h.Run(1);
    CHECK(!h.c.connected());
    CHECK(h.c.configured());
    h.received.clear();
    h.Run(500);
    const std::vector<Message> beats = h.Of(MessageType::Heartbeat);
    REQUIRE(beats.size() == 1);
    CHECK(!beats[0].heartbeat.host_alive);
}

TEST("session: host timeout clears the queue and never replays input")
{
    FakeHost h;
    h.Connect();
    h.Press(27); // e.g. Send; the host never read it
    h.Release(27);
    CHECK_EQ(h.c.queued(), 2u);
    h.now += Controller::kHostTimeoutMs;
    h.c.Update(h.now, h.down);
    CHECK(!h.c.connected());
    CHECK_EQ(h.c.queued(), 0u);
    // Input while disconnected is not queued either.
    h.Press(28);
    h.Release(28);
    CHECK_EQ(h.c.queued(), 0u);
    // The host comes back: nothing from before is sent.
    h.Beat();
    h.Drain();
    CHECK(h.Of(MessageType::Input).empty());
}

TEST("session: a key held across a disconnect is not pressed or released")
{
    FakeHost h;
    h.Connect();
    h.Press(26); // Record held
    h.Drain();
    h.received.clear();
    h.now += Controller::kHostTimeoutMs; // host lost while held
    h.Drain();
    CHECK(!h.c.connected());
    h.Beat(); // host back, key still held
    h.Drain();
    h.Release(26);
    h.Drain();
    CHECK(h.Of(MessageType::Input).empty());
    h.Press(26); // a fresh press counts again
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == 1);
    CHECK(in[0].input.kind == InputKind::Press);
}

TEST("session: a key held at power-on is ignored until released")
{
    FakeHost h;
    h.down = Bit(34); // volume click held at boot
    h.Connect();
    h.Release(34);
    h.Drain();
    CHECK(h.Of(MessageType::Input).empty());
    h.Press(34);
    h.Release(34);
    h.Drain();
    CHECK_EQ(h.Of(MessageType::Input).size(), 2u);
}

TEST("session: a new enumeration restarts epoch, sequence and lights")
{
    FakeHost h;
    h.Connect(0x1111);
    Rgb colors[kMaxLedsPerPart];
    std::memset(colors, 9, sizeof(colors));
    h.SendLeds(5, 0, colors);
    h.SendLeds(5, 1, colors);
    CHECK_EQ(h.c.last_applied_frame(), 5);
    h.Press(1);
    h.Drain();
    h.Press(2); // left in the queue
    h.c.OnUsbDeconfigured();
    h.Connect(0x2222);
    CHECK_EQ(h.c.last_applied_frame(), 0);
    CHECK_EQ(h.c.queued(), 0u);
    h.Press(3);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == 1);
    CHECK_EQ(in[0].input.epoch, 0x2222);
    CHECK_EQ(in[0].input.sequence, 1);
    CHECK_EQ(in[0].input.control, 3);
}

TEST("session: invalid host reports take no action")
{
    FakeHost h;
    h.Enumerate(0x1234);
    h.Drain();
    uint8_t r[kReportSize] = {0};
    // Over-range brightness: no liveness, no brightness change.
    r[0] = 0x82;
    r[1] = 0x01;
    r[6] = 101;
    CHECK(h.Send(r) == Reason::InvalidBrightness);
    h.Drain();
    CHECK(!h.c.host_alive());
    // Wrong version on a heartbeat.
    r[1] = 0x02;
    r[6] = 50;
    CHECK(h.Send(r) == Reason::UnsupportedVersion);
    h.Drain();
    CHECK(!h.c.host_alive());
    // Short report.
    CHECK(h.c.OnHostReport(r, 10, h.now) == Reason::InvalidLength);
    // A device-to-host message from the host is ignored.
    EncodeHello(MakeHello(0x1234), r);
    CHECK(h.Send(r) == Reason::UnknownType);
    h.Drain();
    CHECK(!h.c.host_alive());

    h.Beat(40, 9);
    CHECK_EQ(h.c.brightness_percent(), 40);
    CHECK_EQ(h.c.profile_version(), 9u);
    // A bad light part changes nothing.
    std::memset(r, 0, sizeof(r));
    r[0] = 0x81;
    r[1] = 0x01;
    r[2] = 3;
    r[4] = 1;
    r[5] = 19;
    CHECK(h.Send(r) == Reason::InvalidLedRange);
    CHECK_EQ(h.c.last_applied_frame(), 0);
}

TEST("lights: a frame applies only when both parts match")
{
    FakeHost h;
    h.Connect();
    Rgb a[kMaxLedsPerPart], b[kMaxLedsPerPart];
    for(uint8_t i = 0; i < kMaxLedsPerPart; ++i)
    {
        a[i] = Rgb{i, static_cast<uint8_t>(i + 1), static_cast<uint8_t>(i + 2)};
        b[i] = Rgb{static_cast<uint8_t>(100 + i), 0, 0};
    }
    h.SendLeds(7, 0, a);
    CHECK_EQ(h.c.last_applied_frame(), 0);
    CHECK(h.c.applied_leds()[1].r == 0);
    h.SendLeds(8, 1, b); // other frame: still nothing
    CHECK_EQ(h.c.last_applied_frame(), 0);
    h.SendLeds(7, 1, b);
    CHECK_EQ(h.c.last_applied_frame(), 7);
    CHECK_EQ(h.c.applied_leds()[1].g, 2);
    CHECK_EQ(h.c.applied_leds()[19].r, 100);
    CHECK_EQ(h.c.applied_leds()[34].r, 115);

    // Parts may arrive in either order; a stale part never mixes in.
    h.SendLeds(9, 1, a);
    h.SendLeds(10, 0, b);
    CHECK_EQ(h.c.last_applied_frame(), 7);
    h.SendLeds(10, 1, a);
    CHECK_EQ(h.c.last_applied_frame(), 10);
    CHECK_EQ(h.c.applied_leds()[0].r, 100);
    CHECK_EQ(h.c.applied_leds()[19].r, 0);
    // A repeated part after a frame applied does not apply anything.
    h.SendLeds(10, 1, b);
    CHECK_EQ(h.c.applied_leds()[19].r, 0);

    h.Run(500, true);
    const std::vector<Message> beats = h.Of(MessageType::Heartbeat);
    REQUIRE(!beats.empty());
    CHECK_EQ(beats.back().heartbeat.led_frame, 10);
}

TEST("lights: disconnected pattern until a host is live, cleared after loss")
{
    FakeHost h;
    ChainFrame shown, disconnected;
    h.c.Render(h.now, &shown);
    RenderDisconnected(h.now, &disconnected);
    CHECK(SameFrame(shown, disconnected));

    h.Connect();
    h.c.Render(h.now, &shown);
    CHECK(AllOff(shown)); // live host, no frame yet

    Rgb part0[kMaxLedsPerPart], part1[kMaxLedsPerPart];
    std::memset(part0, 200, sizeof(part0));
    std::memset(part1, 200, sizeof(part1));
    h.SendLeds(1, 0, part0);
    h.SendLeds(1, 1, part1);
    h.c.Render(h.now, &shown);
    CHECK_EQ(shown.keys[0][0], 200 / 4);
    CHECK_EQ(shown.panel[0][0], 200 / 11);

    h.now += Controller::kHostTimeoutMs;
    h.Drain();
    h.c.Render(h.now, &shown);
    RenderDisconnected(h.now, &disconnected);
    CHECK(SameFrame(shown, disconnected));

    // When the host returns, the stale frame is not shown again.
    h.Beat();
    h.Drain();
    h.c.Render(h.now, &shown);
    CHECK(AllOff(shown));
}

TEST("lights: a host timeout reports frame 0 and stays dark until a new frame")
{
    FakeHost h;
    h.Connect();
    Rgb part[kMaxLedsPerPart];
    std::memset(part, 120, sizeof(part));
    h.SendLeds(7, 0, part);
    h.SendLeds(7, 1, part);
    h.Run(500, true);
    std::vector<Message> beats = h.Of(MessageType::Heartbeat);
    REQUIRE(!beats.empty());
    CHECK_EQ(beats.back().heartbeat.led_frame, 7);

    h.Run(Controller::kHostTimeoutMs + 500); // the host stops heartbeating
    CHECK(!h.c.connected());
    CHECK_EQ(h.c.last_applied_frame(), 0);

    h.received.clear();
    h.Beat(); // the host resumes but has not resent its frame
    h.Run(1000, true);
    beats = h.Of(MessageType::Heartbeat);
    REQUIRE(!beats.empty());
    for(const Message& m : beats)
    {
        CHECK(m.heartbeat.host_alive);
        CHECK_EQ(m.heartbeat.led_frame, 0);
    }
    ChainFrame shown;
    h.c.Render(h.now, &shown);
    CHECK(AllOff(shown));

    // Half a frame changes nothing; the full frame applies and is reported.
    h.SendLeds(8, 0, part);
    CHECK_EQ(h.c.last_applied_frame(), 0);
    h.c.Render(h.now, &shown);
    CHECK(AllOff(shown));
    h.SendLeds(8, 1, part);
    h.received.clear();
    h.Run(500, true);
    beats = h.Of(MessageType::Heartbeat);
    REQUIRE(!beats.empty());
    CHECK_EQ(beats.back().heartbeat.led_frame, 8);
    h.c.Render(h.now, &shown);
    CHECK_EQ(shown.keys[0][0], 120 / 4);
}

TEST("lights: host brightness percent scales before the caps")
{
    FakeHost h;
    h.Connect();
    h.Beat(50);
    Rgb part[kMaxLedsPerPart];
    std::memset(part, 255, sizeof(part));
    h.SendLeds(2, 0, part);
    h.SendLeds(2, 1, part);
    ChainFrame shown;
    h.c.Render(h.now, &shown);
    CHECK_EQ(shown.keys[0][0], 127 / 4);
    CHECK_EQ(shown.panel[9][2], 127 / 11);
}

TEST("roundtrip: fake host drives the fixture light frame and reads events")
{
    // Load the fixture light frame and push it through the controller as a
    // bridge would, then read back events as the bridge would.
    const json::Value doc = json::ParseFile(testing::FixturePath());
    FakeHost          h;
    h.Connect(0x1234);
    Rgb expected[kLedCount];
    for(const json::Value& v : doc["vectors"].array)
    {
        if(!v["valid"].boolean || v["message"]["type"].string != "leds")
            continue;
        const json::Value& m = v["message"];
        LedsMsg            msg{};
        msg.frame = static_cast<uint16_t>(m["frame"].number);
        msg.part  = static_cast<uint8_t>(m["part"].number);
        msg.count = static_cast<uint8_t>(m["colors"].size());
        for(size_t i = 0; i < m["colors"].size(); ++i)
        {
            msg.colors[i] = Rgb{static_cast<uint8_t>(m["colors"][i][0].number),
                                static_cast<uint8_t>(m["colors"][i][1].number),
                                static_cast<uint8_t>(m["colors"][i][2].number)};
            expected[m["first"].number + static_cast<int64_t>(i)] = msg.colors[i];
        }
        uint8_t r[kReportSize];
        EncodeLeds(msg, r);
        CHECK(h.Send(r) == Reason::Ok);
    }
    CHECK_EQ(h.c.last_applied_frame(), 7);
    for(uint8_t i = 0; i < kLedCount; ++i)
    {
        CHECK_EQ(h.c.applied_leds()[i].r, expected[i].r);
        CHECK_EQ(h.c.applied_leds()[i].g, expected[i].g);
        CHECK_EQ(h.c.applied_leds()[i].b, expected[i].b);
    }
    ChainFrame shown;
    h.c.Render(h.now, &shown);
    // Key 2 (LED 1) is key-chain position 23, sent G,R,B.
    CHECK_EQ(shown.keys[23][0], expected[1].g / 4);
    CHECK_EQ(shown.keys[23][1], expected[1].r / 4);
    // Volume LED (34) is panel position 9, sent R,G,B.
    CHECK_EQ(shown.panel[9][0], expected[34].r / 11);

    h.Press(1);
    h.Release(15);
    h.Press(33);
    h.Turn(41, 2);
    h.Drain();
    const std::vector<Message> in = h.Of(MessageType::Input);
    REQUIRE(in.size() == 4);
    CHECK_EQ(in[0].input.control, 1);
    CHECK_EQ(in[1].input.control, 15);
    CHECK_EQ(in[2].input.control, 33);
    CHECK_EQ(in[3].input.delta, 2);
    // The first input report is byte-identical to the fixture vector.
    uint8_t first[kReportSize];
    EncodeInput(in[0].input, first);
    for(const json::Value& v : doc["vectors"].array)
    {
        if(v["name"].string != "input press key 1")
            continue;
        const std::string& hex = v["report"].string;
        for(size_t i = 0; i < kReportSize; ++i)
            CHECK_EQ(first[i], std::stoi(hex.substr(i * 2, 2), nullptr, 16));
    }
}
