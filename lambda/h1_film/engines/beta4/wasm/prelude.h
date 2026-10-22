#pragma once
#include "../../beta3/wasm/prelude.h"
typedef int64_t __time64_t;
int _putenv_s(const char *name, const char *value);
int fopen_s(FILE **output, const char *path, const char *mode);
static inline __time64_t _time64(__time64_t *result) {
    const __time64_t now = (__time64_t)time(NULL);
    if (result) *result = now;
    return now;
}
