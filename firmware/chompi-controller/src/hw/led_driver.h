// WS2812 driver for CHOMPI's two LED chains (timer PWM + DMA).
//
// Adapted from sfaber02/CHOMPI launcher-v1.1 (79ea9e7),
// firmware/chompi-launcher/code/src/temp_led_stuff.h, which comes from the
// CHOMPI-Club/CHOMPI firmwares. MIT License, Copyright (c) 2026 CHOMPI Club;
// see THIRD_PARTY.md. Colour scaling, caps and byte order moved to
// core/leds.cpp.
#pragma once

#include "core/leds.h"

namespace agentctl
{
namespace hw
{

// Starts both timers and the self-retriggering DMA chain.
void LedSetup();

// Converts one rendered frame into PWM pulse lengths for the running DMA.
void LedShow(const ChainFrame& frame);

// All LEDs off (writes a dark frame).
void LedsOff();

// Stops the DMA chain. Must run before any reset or firmware handover: a
// WS2812 frame cut short corrupts the next firmware's first frame.
void StopLeds();

} // namespace hw
} // namespace agentctl
