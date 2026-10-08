#pragma once
static inline unsigned char _BitScanReverse(unsigned long *index, unsigned long value) {
    if (!value) return 0;
    *index = 31u - __builtin_clz((unsigned int)value);
    return 1;
}
#define _ReturnAddress() ((void *)0)
