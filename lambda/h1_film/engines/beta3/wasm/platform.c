#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <errno.h>
#include <ctype.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdarg.h>
#include <wctype.h>
#include <glob.h>
#include <emscripten.h>
#include "windows.h"
#undef __builtin_clz
#undef __builtin_sqrtf

EM_JS(void, hs_wasm_emit, (const void *data, uint32_t size), {
    const fs = require('node:fs');
    const fd = Number(process.env.H1_EXPORT_HANDLE);
    if (!Number.isInteger(fd) || fd < 3) throw new Error('Missing dedicated binary output descriptor');
    const deadline = Date.now() + 60000;
    let done = 0;
    while (done < size) {
        try {
            const written = fs.writeSync(fd, HEAPU8, data + done, size - done);
            if (!written) throw new Error('Encoder pipe closed');
            done += written;
        } catch (error) {
            if (error.code !== 'EAGAIN' || Date.now() >= deadline) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
        }
    }
});

float __fsqrts(float x) { return sqrtf(x); }
double __fabs(double x) { return fabs(x); }
float blampc_sqrtf(float x) { return sqrtf(x); }
int _cntlzw(unsigned int x) { return x ? __builtin_clz(x) : 32; }
int blampc_clz(unsigned int x) { return _cntlzw(x); }
void _blkmov(void *dst, const void *src, int size) { if (size > 0) memmove(dst, src, size); }
void __trap(void) { __builtin_trap(); }
void hs_pix_begin_event_timed(int label, double a, double b) { (void)label; (void)a; (void)b; }
int _finite(double value) { return isfinite(value); }
int _isnan(double value) { return isnan(value); }
unsigned short *__pctype_func(void) {
    /* Recovered callers use MSVC's upper/lower/digit/space masks, in C locale. */
    static unsigned short table[384];
    static int initialized;
    if (!initialized) {
        for (int c = 0; c < 256; ++c)
            table[c + 128] = (isupper(c) ? 1 : 0) | (islower(c) ? 2 : 0)
                | (isdigit(c) ? 4 : 0) | (isspace(c) ? 8 : 0);
        initialized = 1;
    }
    return table + 128;
}
int _putenv(const char *assignment) {
    char *copy = strdup(assignment);
    if (!copy) return -1;
    char *separator = strchr(copy, '=');
    if (!separator || separator == copy) { free(copy); return -1; }
    *separator++ = 0;
    int result = *separator ? setenv(copy, separator, 1) : unsetenv(copy);
    free(copy);
    return result;
}
unsigned int _clearfp(void) { return 0; }
unsigned int _controlfp(unsigned int value, unsigned int mask) { (void)value; (void)mask; abort(); }
int _snprintf(char *buffer, size_t capacity, const char *format, ...) {
    va_list args; va_start(args, format);
    int count = vsnprintf(buffer, capacity, format, args);
    va_end(args);
    return count;
}
int _vsnprintf(char *buffer, size_t capacity, const char *format, va_list args) {
    return vsnprintf(buffer, capacity, format, args);
}
unsigned short hs_towlower16(unsigned short value) { return (unsigned short)towlower(value); }
unsigned short hs_towupper16(unsigned short value) { return (unsigned short)towupper(value); }
int hs_iswctype16(wchar_t value, unsigned short mask) { if (mask != 8) abort(); return iswspace(value); }
int _wcsicmp(const wchar_t *left, const wchar_t *right) {
    while (*left && towlower(*left) == towlower(*right)) { ++left; ++right; }
    return (int)towlower(*left) - (int)towlower(*right);
}
int strnicmp(const char *left, const char *right, size_t count) { return strncasecmp(left, right, count); }
int wcsnicmp(const wchar_t *left, const wchar_t *right, size_t count) {
    for (size_t i = 0; i < count; ++i) {
        int difference = (int)towlower(left[i]) - (int)towlower(right[i]);
        if (difference || !left[i]) return difference;
    }
    return 0;
}
int _wtoi(const wchar_t *value) {
    char text[64]; size_t size = 0;
    while (value[size] && size + 1 < sizeof(text)) { text[size] = (char)value[size]; ++size; }
    text[size] = 0;
    return atoi(text);
}
__time32_t _time32(__time32_t *result) {
    __time32_t value = (__time32_t)time(0);
    if (result) *result = value;
    return value;
}
struct tm *_localtime32(const __time32_t *value) { time_t converted = *value; return localtime(&converted); }

/* The engine's strings are UTF-16. Emscripten's prebuilt libc uses 32-bit wchar_t. */
_Static_assert(sizeof(wchar_t) == 2, "Engine UTF-16 layout");
size_t hs_wcslen(const wchar_t *text) { const wchar_t *end = text; while (*end) ++end; return end - text; }
size_t hs_wcsnlen(const wchar_t *text, size_t count) { size_t size = 0; while (size < count && text[size]) ++size; return size; }
wchar_t *hs_wcscpy(wchar_t *out, const wchar_t *in) { wchar_t *start = out; do { *out++ = *in; } while (*in++); return start; }
wchar_t *hs_wcsncpy(wchar_t *out, const wchar_t *in, size_t count) {
    size_t i = 0; for (; i < count && in[i]; ++i) out[i] = in[i];
    for (; i < count; ++i) out[i] = 0; return out;
}
wchar_t *hs_wcscat(wchar_t *out, const wchar_t *in) { hs_wcscpy(out + hs_wcslen(out), in); return out; }
wchar_t *hs_wcsncat(wchar_t *out, const wchar_t *in, size_t count) {
    size_t offset = hs_wcslen(out), i = 0;
    for (; i < count && in[i]; ++i) out[offset + i] = in[i];
    out[offset + i] = 0; return out;
}
int hs_wcscmp(const wchar_t *a, const wchar_t *b) { while (*a && *a == *b) { ++a; ++b; } return (int)*a - (int)*b; }
int hs_wcsncmp(const wchar_t *a, const wchar_t *b, size_t count) {
    for (size_t i = 0; i < count; ++i) { if (a[i] != b[i]) return (int)a[i] - (int)b[i]; if (!a[i]) break; }
    return 0;
}
wchar_t *hs_wcschr(const wchar_t *text, wchar_t c) { do { if (*text == c) return (wchar_t *)text; } while (*text++); return 0; }
wchar_t *hs_wcsrchr(const wchar_t *text, wchar_t c) { wchar_t *last = 0; do { if (*text == c) last = (wchar_t *)text; } while (*text++); return last; }
wchar_t *hs_wcsstr(const wchar_t *text, const wchar_t *needle) {
    size_t count = hs_wcslen(needle);
    do { if (!hs_wcsncmp(text, needle, count)) return (wchar_t *)text; } while (*text++);
    return 0;
}

void *VirtualAlloc(void *address, unsigned int size, unsigned int type, unsigned int protection) {
    (void)type; (void)protection;
    if (address == (void *)0x30000000 && size == 0x448000) return address;
    if (address == (void *)0x40440000 && size == 0x1700000) return address;
    if (address) abort();
    return calloc(1, size);
}
BOOL VirtualFree(void *address, unsigned int size, unsigned int type) {
    (void)size; (void)type;
    if (address != (void *)0x30000000 && address != (void *)0x40440000) free(address);
    return 1;
}

static DWORD last_error;
typedef struct hs_event {
    struct hs_event *next;
    int manual, signaled, mutex, depth;
    char *name;
} hs_event;
static hs_event *events;
static hs_event *event_handle(HANDLE handle) {
    for (hs_event *event = events; event; event = event->next) if (event == handle) return event;
    return NULL;
}
HANDLE CreateEventA(void *attributes, int manual, int signaled, const char *name) {
    (void)attributes;
    if (name) abort();
    hs_event *event = calloc(1, sizeof(*event));
    if (!event) abort();
    event->manual = manual; event->signaled = signaled; event->next = events; events = event;
    return event;
}
HANDLE CreateMutexA(void *attributes, int owner, const char *name) {
    (void)attributes;
    /* This engine runs on one thread; a mutex is recursively acquired by it. */
    for (hs_event *entry = events; name && entry; entry = entry->next)
        if (entry->name && !strcmp(entry->name, name)) abort();
    hs_event *mutex = CreateEventA(NULL, 1, 1, NULL);
    mutex->mutex = 1; mutex->depth = !!owner;
    if (name && !(mutex->name = strdup(name))) abort();
    return mutex;
}
BOOL SetEvent(HANDLE handle) {
    extern void hs_cache_wake(void *event);
    hs_event *event = event_handle(handle);
    if (!event || event->mutex) abort();
    event->signaled = 1; hs_cache_wake(handle); return 1;
}
BOOL ResetEvent(HANDLE handle) {
    hs_event *event = event_handle(handle);
    if (!event || event->mutex) abort();
    event->signaled = 0; return 1;
}
static const char *host_path(const char *input, char *output, size_t capacity) {
    size_t n = strlen(input);
    if (n >= capacity) abort();
    for (size_t i = 0; i <= n; ++i) output[i] = input[i] == '\\' ? '/' : input[i];
    if ((output[0] == 'd' || output[0] == 'D') && output[1] == ':') return output + 3;
    return output;
}
DWORD GetLastError(void) { return last_error; }
void SetLastError(DWORD error) { last_error = error; }
HANDLE CreateFileA(const char *name, DWORD access, DWORD share, void *security,
                   DWORD creation, DWORD flags, HANDLE template) {
    char path[4096];
    (void)share; (void)security; (void)flags; (void)template;
    const char *mode = access & GENERIC_WRITE ? "r+b" : "rb";
    if (creation == CREATE_ALWAYS) mode = "w+b";
    FILE *file = fopen(host_path(name, path, sizeof(path)), mode);
    if (!file && creation == OPEN_ALWAYS) file = fopen(path, "w+b");
    if (!file) { last_error = ERROR_FILE_NOT_FOUND; return INVALID_HANDLE_VALUE; }
    return file;
}
HANDLE blampc_CreateFileA(const char *name, DWORD access, DWORD share, void *security,
                          DWORD creation, DWORD flags, HANDLE template) {
    return CreateFileA(name, access, share, security, creation, flags, template);
}
BOOL CloseHandle(HANDLE file) {
    for (hs_event **entry = &events; *entry; entry = &(*entry)->next) {
        if (*entry == file) {
            hs_event *event = *entry; *entry = event->next;
            free(event->name); free(event); return 1;
        }
    }
    return file && file != INVALID_HANDLE_VALUE && fclose(file) == 0;
}
BOOL ReadFile(HANDLE file, void *buffer, DWORD size, DWORD *read, OVERLAPPED *overlap) {
    if (overlap && fseek(file, overlap->Offset, SEEK_SET)) return 0;
    size_t count = fread(buffer, 1, size, file);
    if (read) *read = count;
    return !ferror(file);
}
BOOL WriteFile(HANDLE file, const void *buffer, DWORD size, DWORD *written, OVERLAPPED *overlap) {
    if (overlap && fseek(file, overlap->Offset, SEEK_SET)) return 0;
    size_t count = fwrite(buffer, 1, size, file);
    if (written) *written = count;
    return count == size;
}
BOOL ReadFileEx(HANDLE file, void *buffer, DWORD size, OVERLAPPED *overlap,
                void (*completion)(DWORD, DWORD, OVERLAPPED *)) {
    if (overlap->OffsetHigh) abort();
    DWORD count = 0;
    BOOL ok = ReadFile(file, buffer, size, &count, overlap);
    overlap->Internal = ok ? 0 : ERROR_HANDLE_EOF;
    overlap->InternalHigh = count;
    completion(overlap->Internal, count, overlap);
    return 1;
}
DWORD SleepEx(DWORD delay, BOOL alertable) {
    (void)delay; (void)alertable;
    return 0; /* I/O completions have already run synchronously. */
}
DWORD SetFilePointer(HANDLE file, LONG offset, LONG *high, DWORD origin) {
    if (high && *high) abort();
    if (fseek(file, offset, origin)) return INVALID_SET_FILE_POINTER;
    return ftell(file);
}
BOOL SetFilePointerEx(HANDLE file, LARGE_INTEGER offset, LARGE_INTEGER *position, DWORD origin) {
    if (fseek(file, offset.QuadPart, origin)) return 0;
    if (position) position->QuadPart = ftell(file);
    return 1;
}
DWORD GetFileSize(HANDLE file, DWORD *high) {
    struct stat info;
    if (fstat(fileno(file), &info)) return INVALID_FILE_SIZE;
    if (high) *high = 0;
    return info.st_size;
}
BOOL GetFileSizeEx(HANDLE file, LARGE_INTEGER *size) {
    size->QuadPart = GetFileSize(file, 0);
    return size->QuadPart != INVALID_FILE_SIZE;
}
BOOL GetFileTime(HANDLE file, FILETIME *created, FILETIME *accessed, FILETIME *modified) {
    struct stat info;
    if (fstat(fileno(file), &info)) return 0;
    uint64_t stamp = ((uint64_t)info.st_mtime + 11644473600ull) * 10000000ull;
    FILETIME value = {(DWORD)stamp, (DWORD)(stamp >> 32)};
    if (created) *created = value;
    if (accessed) *accessed = value;
    if (modified) *modified = value;
    return 1;
}
BOOL FlushFileBuffers(HANDLE file) { return fflush(file) == 0; }
BOOL SetEndOfFile(HANDLE file) { return ftruncate(fileno(file), ftell(file)) == 0; }
DWORD GetFileAttributesA(const char *name) {
    char path[4096]; struct stat info;
    if (stat(host_path(name, path, sizeof(path)), &info)) return INVALID_FILE_ATTRIBUTES;
    return S_ISDIR(info.st_mode) ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
}
BOOL GetFileAttributesExA(const char *name, int level, void *result) {
    char path[4096]; struct stat info;
    (void)level;
    if (stat(host_path(name, path, sizeof(path)), &info)) return 0;
    WIN32_FILE_ATTRIBUTE_DATA *data = result;
    memset(data, 0, sizeof(*data));
    data->dwFileAttributes = S_ISDIR(info.st_mode) ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
    data->nFileSizeLow = info.st_size;
    return 1;
}
BOOL CreateDirectoryA(const char *name, void *security) {
    char path[4096]; (void)security;
    if (!mkdir(host_path(name, path, sizeof(path)), 0700)) return 1;
    last_error = errno == EEXIST ? ERROR_ALREADY_EXISTS : ERROR_PATH_NOT_FOUND;
    return 0;
}
DWORD GetTempPathA(DWORD capacity, char *output) {
    if (capacity < 3) return 3;
    memcpy(output, "./", 3); return 2;
}
UINT GetTempFileNameA(const char *directory, const char *prefix, UINT unique, char *output) {
    char path[4096];
    (void)unique;
    snprintf(output, MAX_PATH, "%s/%.3sXXXXXX", host_path(directory, path, sizeof(path)), prefix);
    int fd = mkstemp(output);
    if (fd < 0) return 0;
    close(fd); return 1;
}
BOOL DeleteFileA(const char *name) { char path[4096]; return remove(host_path(name, path, sizeof(path))) == 0; }
int GetLocaleInfoA(DWORD locale, DWORD type, char *out, int capacity) {
    (void)locale;
    if (type != LOCALE_SLIST) abort();
    if (capacity < 2) return 0;
    memcpy(out, ",", 2); return 2;
}
static void system_time(const struct tm *value, SYSTEMTIME *out) {
    *out = (SYSTEMTIME){value->tm_year + 1900, value->tm_mon + 1, value->tm_wday,
        value->tm_mday, value->tm_hour, value->tm_min, value->tm_sec, 0};
}
void GetLocalTime(SYSTEMTIME *out) { time_t now = time(NULL); system_time(localtime(&now), out); }
BOOL FileTimeToSystemTime(const FILETIME *stamp, SYSTEMTIME *out) {
    uint64_t raw = ((uint64_t)stamp->dwHighDateTime << 32) | stamp->dwLowDateTime;
    time_t seconds = (time_t)(raw / 10000000ull) - 11644473600ll;
    system_time(gmtime(&seconds), out); return 1;
}
int CompareFileTime(const FILETIME *a, const FILETIME *b) {
    uint64_t left = ((uint64_t)a->dwHighDateTime << 32) | a->dwLowDateTime;
    uint64_t right = ((uint64_t)b->dwHighDateTime << 32) | b->dwLowDateTime;
    return (left > right) - (left < right);
}
typedef struct { glob_t matches; size_t next; } hs_find;
BOOL FindNextFileA(HANDLE handle, WIN32_FIND_DATAA *out) {
    hs_find *search = handle;
    if (search->next >= search->matches.gl_pathc) return 0;
    const char *path = search->matches.gl_pathv[search->next++];
    const char *name = strrchr(path, '/');
    struct stat info;
    if (stat(path, &info)) return 0;
    memset(out, 0, sizeof(*out));
    snprintf(out->cFileName, sizeof(out->cFileName), "%s", name ? name + 1 : path);
    out->dwFileAttributes = S_ISDIR(info.st_mode) ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
    out->nFileSizeLow = info.st_size;
    uint64_t stamp = ((uint64_t)info.st_mtime + 11644473600ull) * 10000000ull;
    out->ftLastWriteTime = (FILETIME){(DWORD)stamp, (DWORD)(stamp >> 32)};
    return 1;
}
HANDLE FindFirstFileA(const char *pattern, WIN32_FIND_DATAA *out) {
    char path[4096];
    hs_find *search = calloc(1, sizeof(*search));
    if (!search) return INVALID_HANDLE_VALUE;
    if (glob(host_path(pattern, path, sizeof(path)), 0, NULL, &search->matches)
        || !FindNextFileA(search, out)) {
        globfree(&search->matches); free(search); return INVALID_HANDLE_VALUE;
    }
    return search;
}
BOOL FindClose(HANDLE handle) {
    hs_find *search = handle;
    globfree(&search->matches); free(search); return 1;
}
BOOL QueryPerformanceCounter(LARGE_INTEGER *value) { value->QuadPart = (long long)(emscripten_get_now() * 1000.0); return 1; }
BOOL QueryPerformanceFrequency(LARGE_INTEGER *value) { value->QuadPart = 1000000; return 1; }
DWORD GetTickCount(void) { return (DWORD)emscripten_get_now(); }
unsigned int timeGetTime(void) { return GetTickCount(); }
void Sleep(DWORD delay) { if (delay) abort(); }
HANDLE GetProcessHeap(void) { return (HANDLE)1; }
void *HeapAlloc(HANDLE heap, DWORD flags, size_t size) { (void)heap; return flags & HEAP_ZERO_MEMORY ? calloc(1, size) : malloc(size); }
void *HeapReAlloc(HANDLE heap, DWORD flags, void *block, size_t size) { (void)heap; (void)flags; return realloc(block, size); }
BOOL HeapFree(HANDLE heap, DWORD flags, void *block) { (void)heap; (void)flags; free(block); return 1; }
void *GlobalAlloc(UINT flags, size_t size) { return HeapAlloc(0, flags, size); }
void *GlobalReAlloc(void *block, size_t size, UINT flags) { return HeapReAlloc(0, flags, block, size); }
void *LocalFree(void *block) { free(block); return 0; }
void GlobalMemoryStatus(MEMORYSTATUS *info) {
    memset(info, 0, sizeof(*info)); info->dwLength = sizeof(*info);
    info->dwTotalPhys = 0x80000000u; info->dwAvailPhys = 0x40000000u;
    info->dwTotalVirtual = 0x80000000u; info->dwAvailVirtual = 0x40000000u;
}
DWORD WaitForSingleObject(HANDLE handle, DWORD milliseconds) {
    hs_event *event = event_handle(handle);
    if (!event) abort();
    if (event->mutex) { ++event->depth; return WAIT_OBJECT_0; }
    if (!event->signaled) {
        if (milliseconds) abort();
        return WAIT_TIMEOUT;
    }
    if (!event->manual) event->signaled = 0;
    return WAIT_OBJECT_0;
}
BOOL ReleaseMutex(HANDLE handle) {
    hs_event *mutex = event_handle(handle);
    if (!mutex || !mutex->mutex || mutex->depth <= 0) abort();
    --mutex->depth; return 1;
}

int WideCharToMultiByte(UINT page, DWORD flags, const wchar_t *source, int count,
                       char *output, int capacity, const char *replacement, BOOL *used) {
    int total = 0;
    (void)flags; (void)replacement;
    if (page != CP_UTF8) abort();
    if (used) *used = 0;
    if (count < 0) { count = 1; while (source[count - 1]) ++count; }
    for (int i = 0; i < count; ++i) {
        uint32_t cp = source[i];
        if (cp >= 0xd800 && cp <= 0xdbff) {
            if (++i == count || source[i] < 0xdc00 || source[i] > 0xdfff) return 0;
            cp = 0x10000 + ((cp - 0xd800) << 10) + source[i] - 0xdc00;
        } else if (cp >= 0xdc00 && cp <= 0xdfff) return 0;
        int length = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
        if (output) {
            if (total + length > capacity) return 0;
            if (length == 1) output[total] = cp;
            else {
                output[total] = (length == 2 ? 0xc0 : length == 3 ? 0xe0 : 0xf0) | (cp >> (6 * (length - 1)));
                for (int j = 1; j < length; ++j) output[total + j] = 0x80 | ((cp >> (6 * (length - 1 - j))) & 0x3f);
            }
        }
        total += length;
    }
    return total;
}
