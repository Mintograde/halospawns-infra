#pragma once
#include <stdio.h>
typedef long long __time64_t;
__time64_t _time64(__time64_t *result);
int _putenv_s(const char *name, const char *value);
int fopen_s(FILE **output, const char *path, const char *mode);
