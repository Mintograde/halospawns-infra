#pragma once
#include <stdint.h>
typedef int16_t SHORT;
#define XINPUT_GAMEPAD_A 0x1000
#define XINPUT_GAMEPAD_B 0x2000
typedef struct {
    uint16_t wButtons;
    uint8_t bLeftTrigger, bRightTrigger;
    int16_t sThumbLX, sThumbLY, sThumbRX, sThumbRY;
} XINPUT_GAMEPAD;
typedef struct {
    uint32_t dwPacketNumber;
    XINPUT_GAMEPAD Gamepad;
} XINPUT_STATE;
