// Debounce, press/release and encoder tests.
#include <cstring>
#include <vector>

#include "core/hardware_map.h"
#include "core/input.h"
#include "test.h"

using namespace agentctl;

namespace
{
RawInputs Idle()
{
    RawInputs raw;
    std::memset(&raw, 0, sizeof(raw));
    for(size_t i = 0; i < kEncoderCount; ++i)
    {
        raw.enc_a[i] = true; // encoder lines idle high (pull-ups)
        raw.enc_b[i] = true;
    }
    return raw;
}

struct Harness
{
    InputScanner            scanner;
    RawInputs               raw = Idle();
    std::vector<InputEvent> events;

    Harness() { Step(1); } // baseline

    void Step(int samples)
    {
        for(int i = 0; i < samples; ++i)
        {
            InputEvent out[InputScanner::kMaxEventsPerSample];
            const size_t n = scanner.Sample(raw, out, InputScanner::kMaxEventsPerSample);
            events.insert(events.end(), out, out + n);
        }
    }

    // Moves encoder `enc` (1-6) through the given (A, B) states.
    void Quadrature(uint8_t enc, const std::vector<std::pair<bool, bool>>& states,
                    int samples_per_state = 3)
    {
        for(const auto& s : states)
        {
            raw.enc_a[enc - 1] = s.first;
            raw.enc_b[enc - 1] = s.second;
            Step(samples_per_state);
        }
    }
};

// A falls while B is low: +1 by the upstream rule (clockwise).
const std::vector<std::pair<bool, bool>> kForwardCycle
    = {{true, false}, {false, false}, {false, true}, {true, true}};
// B falls while A is low: -1.
const std::vector<std::pair<bool, bool>> kBackwardCycle
    = {{false, true}, {false, false}, {true, false}, {true, true}};

int SumTurns(const std::vector<InputEvent>& events, uint8_t control)
{
    int sum = 0;
    for(const InputEvent& e : events)
        if(e.control == control && e.kind == InputKind::Turn)
            sum += e.delta;
    return sum;
}

int Count(const std::vector<InputEvent>& events, uint8_t control, InputKind kind)
{
    int n = 0;
    for(const InputEvent& e : events)
        if(e.control == control && e.kind == kind)
            ++n;
    return n;
}
} // namespace

TEST("debounce: a change needs seven consecutive samples")
{
    Debouncer d;
    d.Reset(false);
    for(int i = 0; i < Debouncer::kSamples - 1; ++i)
        CHECK_EQ(d.Update(true), 0);
    CHECK(!d.down());
    CHECK_EQ(d.Update(true), 1);
    CHECK(d.down());
    for(int i = 0; i < Debouncer::kSamples - 1; ++i)
        CHECK_EQ(d.Update(false), 0);
    CHECK_EQ(d.Update(false), -1);
    CHECK(!d.down());
}

TEST("debounce: contact bounce never produces an edge")
{
    Debouncer d;
    d.Reset(false);
    for(int i = 0; i < 200; ++i)
        CHECK_EQ(d.Update(i % 3 != 0), 0); // never 7 in a row
    CHECK(!d.down());
    // A glitch inside a stable press restarts the count but keeps the state.
    for(int i = 0; i < Debouncer::kSamples; ++i)
        d.Update(true);
    CHECK(d.down());
    CHECK_EQ(d.Update(false), 0);
    CHECK_EQ(d.Update(true), 0);
    CHECK(d.down());
}

TEST("scanner: press and release produce one event each")
{
    Harness h;
    h.raw.down[4] = true; // control 5
    h.Step(20);
    h.raw.down[4] = false;
    h.Step(20);
    REQUIRE(h.events.size() == 2);
    CHECK_EQ(h.events[0].control, 5);
    CHECK(h.events[0].kind == InputKind::Press);
    CHECK_EQ(h.events[0].delta, 0);
    CHECK_EQ(h.events[1].control, 5);
    CHECK(h.events[1].kind == InputKind::Release);
    CHECK(!h.scanner.IsDown(5));
}

TEST("scanner: a held key reports one press, and its down mask")
{
    Harness h;
    h.raw.down[0]  = true;  // control 1
    h.raw.down[33] = true;  // control 34, volume click
    h.Step(1000);
    CHECK_EQ(Count(h.events, 1, InputKind::Press), 1);
    CHECK_EQ(Count(h.events, 34, InputKind::Press), 1);
    CHECK(h.scanner.IsDown(1));
    CHECK(h.scanner.IsDown(34));
    CHECK_EQ(h.scanner.DownMask(), (uint64_t{1} << 0) | (uint64_t{1} << 33));
}

TEST("scanner: the first sample is a silent baseline")
{
    InputScanner scanner;
    RawInputs    raw = Idle();
    raw.down[25]     = true; // CHOMPI key held at power-on
    InputEvent out[InputScanner::kMaxEventsPerSample];
    CHECK_EQ(scanner.Sample(raw, out, InputScanner::kMaxEventsPerSample), 0u);
    CHECK(scanner.IsDown(26));
    for(int i = 0; i < 50; ++i)
        CHECK_EQ(scanner.Sample(raw, out, InputScanner::kMaxEventsPerSample), 0u);
    scanner.Reset();
    raw.down[25] = false;
    CHECK_EQ(scanner.Sample(raw, out, InputScanner::kMaxEventsPerSample), 0u);
    CHECK(!scanner.IsDown(26));
}

TEST("encoder: forward and backward cycles give opposite directions")
{
    for(uint8_t enc = 1; enc <= 6; ++enc)
    {
        Harness h;
        h.Quadrature(enc, kForwardCycle);
        h.Quadrature(enc, kForwardCycle);
        CHECK_EQ(SumTurns(h.events, TurnControlForEncoder(enc)), 2);
        h.events.clear();
        h.Quadrature(enc, kBackwardCycle);
        CHECK_EQ(SumTurns(h.events, TurnControlForEncoder(enc)), -1);
        for(const InputEvent& e : h.events)
        {
            CHECK_EQ(e.control, TurnControlForEncoder(enc));
            CHECK(e.kind == InputKind::Turn);
            CHECK(e.delta == 1 || e.delta == -1);
        }
    }
}

TEST("encoder: shift-register and GPIO decoders follow the upstream rules")
{
    // Shift register: A must have been high three samples ago.
    QuadratureDecoder sr(QuadratureSource::ShiftRegister);
    CHECK_EQ(sr.Update(true, false), 0);
    CHECK_EQ(sr.Update(false, false), 0);
    CHECK_EQ(sr.Update(false, false), 1);
    CHECK_EQ(sr.Update(false, false), 0);

    // GPIO: the falling sample itself counts.
    QuadratureDecoder gpio(QuadratureSource::Gpio);
    CHECK_EQ(gpio.Update(true, false), 0);
    CHECK_EQ(gpio.Update(true, false), 0);
    CHECK_EQ(gpio.Update(false, false), 1);
    CHECK_EQ(gpio.Update(false, false), 0);
    CHECK_EQ(gpio.Update(false, true), 0);
    CHECK_EQ(gpio.Update(false, true), 0);
    CHECK_EQ(gpio.Update(false, false), -1);
}

TEST("encoder: turning never produces a click and clicking never a turn")
{
    Harness h;
    // Turn ENC_5 (the big wheel) with its click up.
    for(int i = 0; i < 5; ++i)
        h.Quadrature(5, kForwardCycle);
    CHECK_EQ(SumTurns(h.events, 45), 5);
    CHECK_EQ(Count(h.events, 33, InputKind::Press), 0);

    // Click without turning.
    h.events.clear();
    h.raw.down[32] = true; // control 33
    h.Step(20);
    h.raw.down[32] = false;
    h.Step(20);
    CHECK_EQ(Count(h.events, 33, InputKind::Press), 1);
    CHECK_EQ(Count(h.events, 33, InputKind::Release), 1);
    CHECK_EQ(SumTurns(h.events, 45), 0);

    // Turn while the click is held: both arrive, on separate IDs.
    h.events.clear();
    h.raw.down[32] = true;
    h.Step(20);
    h.Quadrature(5, kBackwardCycle);
    h.Quadrature(5, kBackwardCycle);
    h.raw.down[32] = false;
    h.Step(20);
    CHECK_EQ(Count(h.events, 33, InputKind::Press), 1);
    CHECK_EQ(Count(h.events, 33, InputKind::Release), 1);
    CHECK_EQ(SumTurns(h.events, 45), -2);
}

TEST("encoder: a bouncing click line is still one click")
{
    Harness h;
    for(int i = 0; i < 6; ++i)
    {
        h.raw.down[28] = (i % 2) == 0; // control 29, ENC_1 click
        h.Step(2);
    }
    h.raw.down[28] = true;
    h.Step(20);
    CHECK_EQ(Count(h.events, 29, InputKind::Press), 1);
    CHECK_EQ(SumTurns(h.events, 41), 0);
}

TEST("hardware map: every control once, far-left switch never")
{
    int seen[kControlCount + 1] = {0};
    for(uint8_t bit = 0; bit < kButtonChainBits; ++bit)
    {
        const uint8_t control = kButtonBitToControl[bit];
        if(control == 0)
            continue;
        REQUIRE(control >= 1 && control <= kControlCount);
        ++seen[control];
    }
    seen[kEnc5ClickControl]++;
    for(uint8_t c = 1; c <= kControlCount; ++c)
        CHECK_EQ(seen[c], 1);
    CHECK_EQ(kButtonBitToControl[kToggleSwitchBit], 0);
    // Keys 1-15 left to right on the front row.
    CHECK_EQ(kButtonBitToControl[15], 1);
    CHECK_EQ(kButtonBitToControl[28], 15);
    CHECK_EQ(kButtonBitToControl[5], 26);
    CHECK_EQ(kButtonBitToControl[33], 27);
    CHECK_EQ(kButtonBitToControl[34], 28);
}
