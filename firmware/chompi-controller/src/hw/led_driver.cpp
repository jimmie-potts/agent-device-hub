// Adapted from sfaber02/CHOMPI launcher-v1.1 (79ea9e7),
// firmware/chompi-launcher/code/src/temp_led_stuff.h. MIT License, Copyright
// (c) 2026 CHOMPI Club; see THIRD_PARTY.md. Timers, pins and the stop sequence
// are unchanged. Pulse encoding, including the idle-line porch, is in
// core/leds.cpp.
#include "led_driver.h"

#include <cstring>

#include "daisy_seed.h"

namespace agentctl
{
namespace hw
{
namespace
{
daisy::TimerHandle tim3_smt, tim5_pth;
daisy::TimChannel  led_pth_pwm, led_smt_pwm;

constexpr size_t kOutPthSize = ChainPulseCount(kPanelLedCount);
constexpr size_t kOutSmtSize = ChainPulseCount(kKeyLedCount);

// One PWM duration per colour bit. In the DMA-capable SRAM section.
uint32_t DMA_BUFFER_MEM_SECTION output_pth_data[kOutPthSize];
uint32_t DMA_BUFFER_MEM_SECTION output_smt_data[kOutSmtSize];

// Cleared to let the self-retriggering chain wind down.
volatile bool leds_running = true;

void EndOfLeds(void* context);

void EndOfLeds(void* context)
{
    daisy::TimChannel* pwm = static_cast<daisy::TimChannel*>(context);

    if(!leds_running)
    {
        pwm->SetPwm(0);
        pwm->Stop();
        return;
    }

    // Alternate chains: PTH done starts SMT, SMT done starts PTH.
    pwm->SetPwm(0);
    if(pwm->GetConfig().chn == daisy::TimChannel::Config::Channel::FOUR)
    {
        led_smt_pwm.Start();
        led_smt_pwm.StartDma(output_smt_data, kOutSmtSize, EndOfLeds,
                             static_cast<void*>(&led_smt_pwm));
    }
    else
    {
        led_pth_pwm.Start();
        led_pth_pwm.StartDma(output_pth_data, kOutPthSize, EndOfLeds,
                             static_cast<void*>(&led_pth_pwm));
    }
}
} // namespace

void LedSetup()
{
    std::memset(output_pth_data, 0, sizeof(output_pth_data));
    std::memset(output_smt_data, 0, sizeof(output_smt_data));

    daisy::TimerHandle::Config tim3_cfg;
    daisy::TimerHandle::Config tim5_cfg;
    tim3_cfg.periph = daisy::TimerHandle::Config::Peripheral::TIM_3;
    tim5_cfg.periph = daisy::TimerHandle::Config::Peripheral::TIM_5;
    tim3_cfg.dir    = daisy::TimerHandle::Config::CounterDir::UP;
    tim5_cfg.dir    = daisy::TimerHandle::Config::CounterDir::UP;
    tim3_smt.Init(tim3_cfg);
    tim5_pth.Init(tim5_cfg);

    // 1.2 us symbol length.
    const uint32_t prescaler         = 8;
    const uint32_t tickspeed         = (daisy::System::GetPClk2Freq() * 2) / prescaler;
    const uint32_t target_pulse_freq = 833332;
    const uint32_t period            = (tickspeed / target_pulse_freq) - 1;
    tim3_smt.SetPrescaler(prescaler - 1);
    tim3_smt.SetPeriod(period);
    tim5_pth.SetPrescaler(prescaler - 1);
    tim5_pth.SetPeriod(period);

    // TIM3 CH2 on D18: the 25 key LEDs.
    daisy::TimChannel::Config t3chn2_cfg;
    t3chn2_cfg.tim      = &tim3_smt;
    t3chn2_cfg.chn      = daisy::TimChannel::Config::Channel::TWO;
    t3chn2_cfg.mode     = daisy::TimChannel::Config::Mode::PWM;
    t3chn2_cfg.polarity = daisy::TimChannel::Config::Polarity::HIGH;
    t3chn2_cfg.pin      = daisy::seed::D18;

    // TIM5 CH4 on D16: the 10 panel LEDs.
    daisy::TimChannel::Config t5chn4_cfg;
    t5chn4_cfg.tim      = &tim5_pth;
    t5chn4_cfg.chn      = daisy::TimChannel::Config::Channel::FOUR;
    t5chn4_cfg.mode     = daisy::TimChannel::Config::Mode::PWM;
    t5chn4_cfg.polarity = daisy::TimChannel::Config::Polarity::HIGH;
    t5chn4_cfg.pin      = daisy::seed::D16;

    led_pth_pwm.Init(t5chn4_cfg);
    led_smt_pwm.Init(t3chn2_cfg);

    leds_running = true;
    led_smt_pwm.Start();
    led_smt_pwm.StartDma(output_smt_data, kOutSmtSize, EndOfLeds,
                         static_cast<void*>(&led_smt_pwm));
}

void LedShow(const ChainFrame& frame)
{
    EncodeChain(frame.panel, kPanelLedCount, output_pth_data);
    EncodeChain(frame.keys, kKeyLedCount, output_smt_data);
}

void LedsOff()
{
    ChainFrame dark;
    std::memset(&dark, 0, sizeof(dark));
    LedShow(dark);
}

void StopLeds()
{
    // Clear the flag first so the completion callback stops re-arming, then
    // stop both channels outright.
    leds_running = false;
    led_smt_pwm.SetPwm(0);
    led_pth_pwm.SetPwm(0);
    led_smt_pwm.Stop();
    led_pth_pwm.Stop();
}

} // namespace hw
} // namespace agentctl
