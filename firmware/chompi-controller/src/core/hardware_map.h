// Physical-to-logical control map for the CHOMPI button chain.
//
// Bit order follows Hardware::SwId in the CHOMPI WAVE firmware
// (CHOMPI-Club/CHOMPI firmware/chompi-wave/code/src/hardware.h, MIT): five
// CD4021s, eight bits each, read through libDaisy's ShiftRegister4021. A zero
// entry is never reported. That covers the far-left two-position switch
// (SW_TOG, bit 6) and the unconnected inputs.
#pragma once

#include <cstdint>

namespace agentctl
{

constexpr uint8_t kButtonChainBits = 40;
constexpr uint8_t kToggleSwitchBit = 6; // SW_TOG, never reported

constexpr uint8_t kButtonBitToControl[kButtonChainBits] = {
    29, // 0  ENC_1_SW
    30, // 1  ENC_2_SW
    31, // 2  ENC_3_SW
    32, // 3  ENC_4_SW
    0,  // 4  NC_6 (ENC_5's click is a direct GPIO, see kEnc5ClickControl)
    26, // 5  KEY_26, CHOMPI key
    0,  // 6  SW_TOG, far-left switch: never reported
    16, // 7  KEY_16
    2,  // 8  KEY_2
    3,  // 9  KEY_3
    4,  // 10 KEY_4
    5,  // 11 KEY_5
    17, // 12 KEY_17
    18, // 13 KEY_18
    19, // 14 KEY_19
    1,  // 15 KEY_1
    6,  // 16 KEY_6
    7,  // 17 KEY_7
    8,  // 18 KEY_8
    9,  // 19 KEY_9
    10, // 20 KEY_10
    20, // 21 KEY_20
    21, // 22 KEY_21
    22, // 23 KEY_22
    11, // 24 KEY_11
    12, // 25 KEY_12
    13, // 26 KEY_13
    14, // 27 KEY_14
    15, // 28 KEY_15
    23, // 29 KEY_23
    24, // 30 KEY_24
    25, // 31 KEY_25
    34, // 32 ENC_6_SW, volume click
    27, // 33 KEY_27, Play
    28, // 34 KEY_28, Loop
    0,  // 35 NC_1
    0,  // 36 NC_2
    0,  // 37 NC_3
    0,  // 38 NC_4
    0,  // 39 NC_5
};

// ENC_5's click is read from its own GPIO (Daisy Seed D10).
constexpr uint8_t kEnc5ClickControl = 33;

} // namespace agentctl
