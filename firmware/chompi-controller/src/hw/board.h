// CHOMPI board layer: inputs, the MP2722 charger, the USB switch GPIO and the
// low-battery lockout.
//
// Adapted from sfaber02/CHOMPI launcher-v1.1 (79ea9e7),
// firmware/chompi-launcher/code/src/hardware.h, itself derived from the
// CHOMPI-Club/CHOMPI WAVE firmware. MIT License, Copyright (c) 2026 CHOMPI
// Club; see THIRD_PARTY.md. Audio, MIDI, jack detection and the SD card are
// left out: this firmware never starts audio and never mounts the card.
#pragma once

#include <cstdint>

#include "core/input.h"
#include "daisy_seed.h"

namespace agentctl
{
namespace hw
{

class Board
{
  public:
    // Brings up the Daisy Seed (480 MHz), the charger I2C bus, the USB switch
    // and charger interrupt GPIOs, both CD4021 chains and the direct encoder
    // pins.
    void Init();

    // Shifts both CD4021 chains, reads the direct GPIOs and maps everything to
    // protocol control IDs. The far-left switch and unconnected bits are
    // never copied out.
    void ReadInputs(RawInputs* raw);

    // MP2722 charger access, as in the launcher.
    void MpWrite(uint8_t reg, uint8_t data);
    void MpReadAll();
    // MpReadAll() and wait up to timeout_ms for the DMA read. False on timeout.
    bool ChargerRead(uint32_t timeout_ms = 500);
    uint8_t ChargerRegister(int index) const { return mp_buff_[index]; }

    // Unplugged with a low battery: 15 s amber warning on the panel, then
    // `before_power_off` and shipping mode. On a low-current source with a
    // low battery: LEDs off and STOP mode. Otherwise returns at once.
    void LowBatteryLockoutCheck(void (*before_power_off)());

    daisy::DaisySeed seed;
    daisy::GPIO      usb_sw;  // high: USB data lines to the Daisy
    daisy::GPIO      mpc_int; // MP2722 interrupt, active low

  private:
    static void BatteryCallback(void* context, daisy::I2CHandle::Result result);

    daisy::ShiftRegister4021<5, 1> button_sr_;
    daisy::ShiftRegister4021<1, 1> encoder_sr_;
    daisy::GPIO                    enc5_a_, enc5_b_, enc5_click_;
    daisy::GPIO                    enc6_a_, enc6_b_;
    daisy::I2CHandle               i2c_;

    uint8_t       mp_buff_[6]         = {0};
    volatile bool read_ready_         = false;
    uint8_t       batt_low_bounce_    = 0;
    uint8_t       vin_gd_bounce_      = 0xff;
    uint8_t       legacy_cable_bounce_ = 0;
    uint8_t       iindpm_stat_bounce_ = 0;
};

} // namespace hw
} // namespace agentctl
