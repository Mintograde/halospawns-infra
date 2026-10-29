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

#include <string.h>
#include <unistd.h>
/* Only used as the ignored module handle for executable-path discovery. */
char __ImageBase;
int SetEnvironmentVariableA(const char *name, const char *value) { return (value ? setenv(name, value, 1) : unsetenv(name)) == 0; }
unsigned long GetEnvironmentVariableA(const char *name, char *out, unsigned long room) {
    const char *value = getenv(name);
    if (!value) return 0;
    size_t size = strlen(value);
    if (size >= room) return size + 1;
    memcpy(out, value, size + 1); return size;
}
unsigned long GetCurrentDirectoryA(unsigned long room, char *out) { return getcwd(out, room) ? strlen(out) : 0; }
