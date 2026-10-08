#include <assert.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>

int _vsnwprintf(wchar_t *, size_t, const wchar_t *, va_list);
static int format(wchar_t *out, size_t capacity, const wchar_t *spec, ...) {
    va_list args;
    va_start(args, spec);
    int result = _vsnwprintf(out, capacity, spec, args);
    va_end(args);
    return result;
}
static void equal(const wchar_t *a, const wchar_t *b) {
    while (*a || *b) assert(*a++ == *b++);
}
int main(void) {
    wchar_t out[256];
    assert(format(out, 256, L"%s killed %s (%d)", L"Alpha", L"Jos\u00e9", 42) == 22);
    equal(out, L"Alpha killed Jos\u00e9 (42)");
    format(out, 256, L"%ls %hs %S %c %% %08X %I64d %.2f", L"wide", "ascii", "bytes", '!', 0x1234u, 1234567890123ll, 1.25);
    equal(out, L"wide ascii bytes ! % 00001234 1234567890123 1.25");
    format(out, 256, L"[%*.*s][%04d][%.*u]", -6, 3, L"abcdef", 7, 3, 4u);
    equal(out, L"[abc   ][0007][004]");
    wchar_t guarded[] = { 0xabcd, 0xabcd, 0xabcd, 0xabcd, 0xabcd, 0xabcd };
    assert(format(guarded + 1, 3, L"xy") == 2);
    assert(guarded[0] == 0xabcd && guarded[1] == 'x' && guarded[2] == 'y' && guarded[3] == 0 && guarded[4] == 0xabcd);
    assert(format(guarded + 1, 3, L"abc") == 3);
    assert(guarded[3] == 'c' && guarded[4] == 0xabcd);
    assert(format(guarded + 1, 3, L"abcd") == -1);
    assert(guarded[0] == 0xabcd && guarded[1] == 'a' && guarded[3] == 'c' && guarded[4] == 0xabcd);
    assert(format(NULL, 0, L"") == 0);
    assert(format(NULL, 0, L"x") == -1);
    puts("UTF-16 formatter tests passed");
    return 0;
}
