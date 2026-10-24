#include <stdio.h>
#include <stdint.h>
#include "particle-count-expression.h"

int main(int argc, char **argv)
{
    static const float counts[] = { 1.0f, 6.0f, 30.0f, 127.0f, 1024.0f, 32767.0f };
    uint32_t seed = 123456789u;
    FILE *output = argc == 2 ? fopen(argv[1], "wb") : 0;
    if (!output) return 1;
    for (int sample = 0; sample < 200000; ++sample) {
        union { float value; uint32_t bits; } fraction;
        seed = 1664525u * seed + 1013904223u;
        if (sample < 65536) fraction.value = (float)sample / 65535.0f;
        else if (sample < 131072) fraction.bits = 0x3f800000u - (sample - 65536);
        else fraction.bits = seed % 0x3f800001u;
        for (int16_t function = 0; function < 6; ++function) {
            for (int count_index = 0; count_index < 6; ++count_index) {
                int result = particle_emit_count(function, fraction.value, -1.0f, counts[count_index]);
                if (fwrite(&result, sizeof result, 1, output) != 1) return 2;
            }
        }
    }
    return fclose(output) ? 3 : 0;
}
