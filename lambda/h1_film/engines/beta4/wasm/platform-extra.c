#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

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
