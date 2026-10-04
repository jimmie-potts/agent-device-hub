// Debounce and encoder decoding for CHOMPI controls, sampled at 1 kHz.
//
// The quadrature rules are ported from the CHOMPI encoder class
// (CHOMPI-Club/CHOMPI firmware/chompi-wave/code/src/encoder.cpp, MIT, itself
// based on Electrosmith's libDaisy Encoder). Hardware reads happen in the
// board layer; this module only sees logic levels.
#pragma once

#include <cstddef>
#include <cstdint>

#include "protocol.h"

namespace agentctl
{

// Accepts a new key state only after it reads the same for kSamples
// consecutive samples, about 7 ms at 1 kHz like the stock firmware.
class Debouncer
{
  public:
    static constexpr uint8_t kSamples = 7;

    void Reset(bool down);
    // Returns +1 on a debounced press, -1 on a debounced release, else 0.
    int  Update(bool raw_down);
    bool down() const { return down_; }

  private:
    bool    down_  = false;
    uint8_t count_ = 0;
};

// The CHOMPI small encoders are read through a CD4021 and use a three-sample
// rule; ENC_5 and ENC_6 are on GPIO pins and use a two-sample rule.
enum class QuadratureSource : uint8_t
{
    ShiftRegister,
    Gpio,
};

class QuadratureDecoder
{
  public:
    explicit QuadratureDecoder(
        QuadratureSource source = QuadratureSource::Gpio)
    : source_(source)
    {
    }

    void Reset();
    // Feed one sample of the A and B lines. Returns +1 (clockwise), -1 or 0.
    int  Update(bool a, bool b);

  private:
    QuadratureSource source_;
    uint8_t          a_ = 0xff;
    uint8_t          b_ = 0xff;
};

// One 1 kHz sample of every reported control, already mapped to protocol
// control IDs by the board layer. Index is control ID - 1 or encoder - 1.
struct RawInputs
{
    bool down[kControlCount];
    bool enc_a[kEncoderCount];
    bool enc_b[kEncoderCount];
};

struct InputEvent
{
    uint8_t   control;
    InputKind kind;
    int8_t    delta;
};

// Turns raw samples into press, release and turn events. Clicks (IDs 29-34)
// and turns (IDs 41-46) come from separate lines, so a turn never produces a
// click and a click never produces a turn.
class InputScanner
{
  public:
    static constexpr size_t kMaxEventsPerSample = kControlCount + kEncoderCount;

    InputScanner();

    // The next sample becomes the baseline and produces no events.
    void   Reset();
    // Returns the number of events written to `out`.
    size_t Sample(const RawInputs& raw, InputEvent* out, size_t capacity);

    bool     IsDown(uint8_t control) const;
    // Bit (control - 1) is set for every debounced-down control.
    uint64_t DownMask() const;

  private:
    Debouncer         keys_[kControlCount];
    QuadratureDecoder encoders_[kEncoderCount];
    bool              have_baseline_ = false;
};

} // namespace agentctl
