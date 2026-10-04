#include "input.h"

namespace agentctl
{

void Debouncer::Reset(bool down)
{
    down_  = down;
    count_ = 0;
}

int Debouncer::Update(bool raw_down)
{
    if(raw_down == down_)
    {
        count_ = 0;
        return 0;
    }
    if(++count_ < kSamples)
        return 0;
    down_  = raw_down;
    count_ = 0;
    return down_ ? 1 : -1;
}

void QuadratureDecoder::Reset()
{
    a_ = 0xff;
    b_ = 0xff;
}

int QuadratureDecoder::Update(bool a, bool b)
{
    a_ = static_cast<uint8_t>((a_ << 1) | (a ? 1 : 0));
    b_ = static_cast<uint8_t>((b_ << 1) | (b ? 1 : 0));

    // Ported from ChompiEncoder::Debounce(): a count is one line settling low
    // while the other is already low. Shift-register samples need the
    // falling line to have read low twice.
    if(source_ == QuadratureSource::ShiftRegister)
    {
        if((a_ & 0x07) == 0x04 && (b_ & 0x03) == 0x00)
            return 1;
        if((b_ & 0x07) == 0x04 && (a_ & 0x03) == 0x00)
            return -1;
        return 0;
    }
    if((a_ & 0x03) == 0x02 && (b_ & 0x03) == 0x00)
        return 1;
    if((b_ & 0x03) == 0x02 && (a_ & 0x03) == 0x00)
        return -1;
    return 0;
}

InputScanner::InputScanner()
{
    for(uint8_t i = 0; i < kEncoderCount; ++i)
        encoders_[i] = QuadratureDecoder(i < 4 ? QuadratureSource::ShiftRegister
                                               : QuadratureSource::Gpio);
    Reset();
}

void InputScanner::Reset()
{
    have_baseline_ = false;
    for(Debouncer& d : keys_)
        d.Reset(false);
    for(QuadratureDecoder& e : encoders_)
        e.Reset();
}

size_t InputScanner::Sample(const RawInputs& raw, InputEvent* out,
                            size_t capacity)
{
    if(!have_baseline_)
    {
        for(uint8_t i = 0; i < kControlCount; ++i)
            keys_[i].Reset(raw.down[i]);
        for(uint8_t i = 0; i < kEncoderCount; ++i)
            encoders_[i].Update(raw.enc_a[i], raw.enc_b[i]);
        have_baseline_ = true;
        return 0;
    }

    size_t n = 0;
    for(uint8_t i = 0; i < kControlCount; ++i)
    {
        const int edge = keys_[i].Update(raw.down[i]);
        if(edge != 0 && n < capacity)
            out[n++] = InputEvent{static_cast<uint8_t>(i + 1),
                                  edge > 0 ? InputKind::Press : InputKind::Release,
                                  0};
    }
    for(uint8_t i = 0; i < kEncoderCount; ++i)
    {
        const int step = encoders_[i].Update(raw.enc_a[i], raw.enc_b[i]);
        if(step != 0 && n < capacity)
            out[n++] = InputEvent{TurnControlForEncoder(static_cast<uint8_t>(i + 1)),
                                  InputKind::Turn, static_cast<int8_t>(step)};
    }
    return n;
}

bool InputScanner::IsDown(uint8_t control) const
{
    return IsButtonControl(control) && keys_[control - 1].down();
}

uint64_t InputScanner::DownMask() const
{
    uint64_t mask = 0;
    for(uint8_t i = 0; i < kControlCount; ++i)
        if(keys_[i].down())
            mask |= uint64_t{1} << i;
    return mask;
}

} // namespace agentctl
