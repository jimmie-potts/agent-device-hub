// Adapted from sfaber02/CHOMPI launcher-v1.1 (79ea9e7),
// firmware/chompi-launcher/code/src/hardware.h. MIT License, Copyright (c)
// 2026 CHOMPI Club; see THIRD_PARTY.md. Pins, charger registers and the
// lockout thresholds are unchanged.
#include "board.h"

#include <cstring>

#include "core/hardware_map.h"
#include "core/leds.h"
#include "led_driver.h"

namespace agentctl
{
namespace hw
{
namespace
{
constexpr uint16_t kChargerAddress = 0x3F;
} // namespace

void Board::Init()
{
    seed.Init(true);

    // MP2722 charger on I2C1 (D11 SCL, D12 SDA).
    daisy::I2CHandle::Config i2c_conf;
    i2c_conf.mode           = daisy::I2CHandle::Config::Mode::I2C_MASTER;
    i2c_conf.periph         = daisy::I2CHandle::Config::Peripheral::I2C_1;
    i2c_conf.speed          = daisy::I2CHandle::Config::Speed::I2C_100KHZ;
    i2c_conf.address        = kChargerAddress;
    i2c_conf.pin_config.scl = daisy::seed::D11;
    i2c_conf.pin_config.sda = daisy::seed::D12;
    i2c_.Init(i2c_conf);

    mpc_int.Init(daisy::seed::D31, daisy::GPIO::Mode::INPUT,
                 daisy::GPIO::Pull::NOPULL);
    usb_sw.Init(daisy::seed::D32, daisy::GPIO::Mode::OUTPUT,
                daisy::GPIO::Pull::NOPULL); // pulled down in hardware

    // ENC_5: A D0, B D20, click D10. ENC_6: A D15, B D17 (click on the chain).
    enc5_a_.Init(daisy::seed::D0, daisy::GPIO::Mode::INPUT, daisy::GPIO::Pull::PULLUP);
    enc5_b_.Init(daisy::seed::D20, daisy::GPIO::Mode::INPUT, daisy::GPIO::Pull::PULLUP);
    enc5_click_.Init(daisy::seed::D10, daisy::GPIO::Mode::INPUT,
                     daisy::GPIO::Pull::PULLUP);
    enc6_a_.Init(daisy::seed::D15, daisy::GPIO::Mode::INPUT, daisy::GPIO::Pull::PULLUP);
    enc6_b_.Init(daisy::seed::D17, daisy::GPIO::Mode::INPUT, daisy::GPIO::Pull::PULLUP);

    // Five CD4021s for keys and clicks; debouncing happens in core/input.
    daisy::ShiftRegister4021<5, 1>::Config button_cfg;
    button_cfg.clk      = daisy::seed::D8;
    button_cfg.latch    = daisy::seed::D7;
    button_cfg.data[0]  = daisy::seed::D9;
    button_cfg.dbc_size = 7;
    button_sr_.Init(button_cfg);

    // One CD4021 for the A/B lines of ENC_1-ENC_4.
    daisy::ShiftRegister4021<1, 1>::Config encoder_cfg;
    encoder_cfg.clk      = daisy::seed::D22;
    encoder_cfg.latch    = daisy::seed::D23;
    encoder_cfg.data[0]  = daisy::seed::D19;
    encoder_cfg.dbc_size = 50;
    encoder_sr_.Init(encoder_cfg);
}

void Board::ReadInputs(RawInputs* raw)
{
    button_sr_.Update();
    encoder_sr_.Update();

    std::memset(raw->down, 0, sizeof(raw->down));
    // The chain inputs have pull-ups: a pressed key reads low.
    for(uint8_t bit = 0; bit < kButtonChainBits; ++bit)
    {
        const uint8_t control = kButtonBitToControl[bit];
        if(control != 0)
            raw->down[control - 1] = !button_sr_.RawState(bit);
    }
    raw->down[kEnc5ClickControl - 1] = !enc5_click_.Read();

    for(int i = 0; i < 4; ++i)
    {
        raw->enc_a[i] = encoder_sr_.RawState(i * 2);
        raw->enc_b[i] = encoder_sr_.RawState(i * 2 + 1);
    }
    raw->enc_a[4] = enc5_a_.Read();
    raw->enc_b[4] = enc5_b_.Read();
    raw->enc_a[5] = enc6_a_.Read();
    raw->enc_b[5] = enc6_b_.Read();
}

void Board::MpWrite(uint8_t reg, uint8_t data)
{
    uint8_t tx_buff[] = {reg, data};
    i2c_.TransmitBlocking(kChargerAddress, tx_buff, 2, 200);
}

void Board::MpReadAll()
{
    uint8_t tx_buff[] = {0x11};
    i2c_.TransmitBlocking(kChargerAddress, tx_buff, 1, 200);
    read_ready_ = false;
    i2c_.ReceiveDma(kChargerAddress | 0B10000000, mp_buff_, sizeof(mp_buff_),
                    BatteryCallback, this);
}

bool Board::ChargerRead(uint32_t timeout_ms)
{
    MpReadAll();
    const uint32_t started = daisy::System::GetNow();
    while(!read_ready_ && daisy::System::GetNow() - started < timeout_ms)
        daisy::System::Delay(1);
    return read_ready_;
}

void Board::BatteryCallback(void* context, daisy::I2CHandle::Result result)
{
    Board* self = static_cast<Board*>(context);
    if(result != daisy::I2CHandle::Result::OK)
        return;

    const uint8_t* buff         = self->mp_buff_;
    const bool     iindpm_stat  = buff[0] & 1;
    const bool     vin_gd       = (buff[1] >> 6) & 1;
    const bool     legacy_cable = (buff[1] >> 4) & 1;
    const bool     batt_low     = (buff[5] >> 4) & 1;

    self->batt_low_bounce_     = static_cast<uint8_t>((self->batt_low_bounce_ << 1) | batt_low);
    self->vin_gd_bounce_       = static_cast<uint8_t>((self->vin_gd_bounce_ << 1) | vin_gd);
    self->legacy_cable_bounce_ = static_cast<uint8_t>((self->legacy_cable_bounce_ << 1) | legacy_cable);
    self->iindpm_stat_bounce_  = static_cast<uint8_t>((self->iindpm_stat_bounce_ << 1) | iindpm_stat);
    self->read_ready_          = true;
}

void Board::LowBatteryLockoutCheck(void (*before_power_off)())
{
    MpReadAll();

    if(batt_low_bounce_ == 0xff && vin_gd_bounce_ == 0x00)
    {
        // Unplugged and low: 15 s amber warning, then shipping mode. Blocking,
        // as in the stock firmware; aborts if power returns.
        const uint32_t start       = daisy::System::GetNow();
        uint32_t       last_update = start;
        while(daisy::System::GetNow() - start < 15000)
        {
            const uint32_t now = daisy::System::GetNow();
            if(now - last_update < 250)
                continue;
            last_update = now;
            MpReadAll();
            if(!(batt_low_bounce_ == 0xff && vin_gd_bounce_ == 0x00))
                return;

            Rgb leds[kLedCount];
            std::memset(leds, 0, sizeof(leds));
            if((now / 250) % 2 == 0)
                for(uint8_t i = kKeyLedCount; i < kLedCount; ++i)
                    leds[i] = Rgb{255, 242, 12}; // the stock amber
            ChainFrame frame;
            RenderFrame(leds, 100, &frame);
            LedShow(frame);
        }
        if(before_power_off != nullptr)
            before_power_off();
        MpWrite(0x08, 0B10111111); // shipping mode
    }

    // On a low-current source with a low battery: dark and asleep.
    while(batt_low_bounce_ == 0xff
          && (legacy_cable_bounce_ == 0xff || iindpm_stat_bounce_ == 0xff))
    {
        LedsOff();
        daisy::System::Delay(100);
        HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);
    }
}

} // namespace hw
} // namespace agentctl
