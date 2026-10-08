#pragma once
#include "blampc_prelude.h"
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdarg.h>
#include <wchar.h>
#include <time.h>
#define index hs_posix_index
#include <string.h>
#undef index
#define index hs_engine_index
int strcasecmp(const char *, const char *);
int strncasecmp(const char *, const char *, size_t);
#ifndef static_assert
#define static_assert _Static_assert
#endif
#define _stricmp strcasecmp
#define _strnicmp strncasecmp
#define stricmp strcasecmp
#define _strdup strdup
#define _strtoui64 strtoull
#define _strtoi64 strtoll
#define _fseeki64 fseeko
#define _ftelli64 ftello
#define _aligned_malloc(size, alignment) memalign(alignment, size)
#define _aligned_free free
#define __debugbreak() __builtin_trap()
int game_time_get(void);
int _finite(double value);
int _isnan(double value);
int _snprintf(char *, size_t, const char *, ...);
int _vsnprintf(char *, size_t, const char *, va_list);
#define sprintf_s snprintf
#define _EM_INVALID 0x10
unsigned int _clearfp(void);
unsigned int _controlfp(unsigned int, unsigned int);
int _wtoi(const wchar_t *);
int _wcsicmp(const wchar_t *, const wchar_t *);
typedef int32_t __time32_t;
__time32_t _time32(__time32_t *);
struct tm *_localtime32(const __time32_t *);
