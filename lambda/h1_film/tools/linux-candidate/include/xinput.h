#pragma once
#include <stdint.h>
typedef int16_t SHORT;
typedef struct {
    uint16_t wButtons;
    uint8_t bLeftTrigger;
    uint8_t bRightTrigger;
    int16_t sThumbLX;
    int16_t sThumbLY;
    int16_t sThumbRX;
    int16_t sThumbRY;
} XINPUT_GAMEPAD;
typedef struct {
    uint32_t dwPacketNumber;
    XINPUT_GAMEPAD Gamepad;
} XINPUT_STATE;
#define XINPUT_GAMEPAD_A 0x1000
#define XINPUT_GAMEPAD_B 0x2000
