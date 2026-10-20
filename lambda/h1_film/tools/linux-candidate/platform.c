#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <stdlib.h>
#include <time.h>
#include "candidate-platform.h"

int hs_usleep(unsigned int microseconds)
{
    if (!microseconds) return 0;
    const struct timespec delay = {
        .tv_sec = microseconds / 1000000u,
        .tv_nsec = (long)(microseconds % 1000000u) * 1000l
    };
    return nanosleep(&delay, NULL);
}

__time64_t _time64(__time64_t *result)
{
    __time64_t value = (__time64_t)time(NULL);
    if (result) *result = value;
    return value;
}

int _putenv_s(const char *name, const char *value)
{
    return *value ? setenv(name, value, 1) : unsetenv(name);
}

int fopen_s(FILE **output, const char *path, const char *mode)
{
    if (!output || !path || !mode) return EINVAL;
    *output = fopen(path, mode);
    return *output ? 0 : errno;
}
