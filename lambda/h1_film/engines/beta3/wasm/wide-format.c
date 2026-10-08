#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

_Static_assert(sizeof(wchar_t) == 2, "Engine strings use UTF-16");

typedef struct { wchar_t *data; size_t capacity, length; } wide_output;
static void put(wide_output *out, wchar_t value) {
    if (out->length < out->capacity) out->data[out->length] = value;
    if (++out->length > INT_MAX) abort();
}
static void unsupported(void) {
    fputs("Unsupported UTF-16 format in headless engine\n", stderr);
    abort();
}
static int decimal(const wchar_t **cursor) {
    int value = 0;
    while (**cursor >= '0' && **cursor <= '9') {
        value = value * 10 + *(*cursor)++ - '0';
        if (value > 4096) unsupported();
    }
    return value;
}

/* MSVC wide printf uses UTF-16 for bare %s. The prebuilt wasm libc uses
 * 32-bit wchar_t, so only numeric conversions can be delegated to it. */
int _vsnwprintf(wchar_t *buffer, size_t capacity, const wchar_t *format, va_list args) {
    wide_output out = { buffer, capacity, 0 };
    if (!format || (!buffer && capacity)) unsupported();
    while (*format) {
        if (*format != '%') { put(&out, *format++); continue; }
        ++format;
        if (*format == '%') { put(&out, *format++); continue; }
        char flags[8] = {0};
        size_t flag_count = 0;
        int left = 0;
        while (*format && *format < 128 && strchr("-+ #0", (char)*format)) {
            if (!strchr(flags, (char)*format)) {
                flags[flag_count++] = (char)*format;
                flags[flag_count] = 0;
            }
            if (*format++ == '-') left = 1;
        }
        int width = 0, precision = -1;
        if (*format == '*') { ++format; width = va_arg(args, int); }
        else width = decimal(&format);
        if (width < -4096 || width > 4096) unsupported();
        if (width < 0) { left = 1; width = -width; }
        if (*format == '.') {
            ++format;
            if (*format == '*') { ++format; precision = va_arg(args, int); }
            else precision = decimal(&format);
        }
        if (precision > 4096) unsupported();
        enum { NONE, H, HH, L, LL, J, Z, T, W, BIG_L } length = NONE;
        if (*format == 'h') { ++format; length = H; if (*format == 'h') { ++format; length = HH; } }
        else if (*format == 'l') { ++format; length = L; if (*format == 'l') { ++format; length = LL; } }
        else if (*format == 'j') { ++format; length = J; }
        else if (*format == 'z') { ++format; length = Z; }
        else if (*format == 't') { ++format; length = T; }
        else if (*format == 'w') { ++format; length = W; }
        else if (*format == 'L') { ++format; length = BIG_L; }
        else if (format[0] == 'I' && format[1] == '6' && format[2] == '4') { format += 3; length = LL; }
        else if (format[0] == 'I' && format[1] == '3' && format[2] == '2') { format += 3; }
        wchar_t conversion = *format++;
        if (!conversion || conversion > 127) unsupported();
        if (conversion == 's' || conversion == 'S' || conversion == 'c' || conversion == 'C') {
            if (length != NONE && length != H && length != L && length != W) unsupported();
            int narrow = length == H || (length == NONE && (conversion == 'S' || conversion == 'C'));
            int character = conversion == 'c' || conversion == 'C';
            wchar_t single[2] = {0, 0};
            const wchar_t *wide = NULL;
            const char *bytes = NULL;
            size_t count = 0;
            if (character) {
                single[0] = (wchar_t)va_arg(args, int);
                if (narrow && single[0] > 127) unsupported();
                wide = single;
                count = 1;
            } else if (narrow) {
                bytes = va_arg(args, const char *);
                if (!bytes) bytes = "(null)";
                while ((precision < 0 || count < (size_t)precision) && bytes[count]) {
                    if ((unsigned char)bytes[count] > 127) unsupported();
                    ++count;
                }
            } else {
                wide = va_arg(args, const wchar_t *);
                if (!wide) wide = L"(null)";
                while ((precision < 0 || count < (size_t)precision) && wide[count]) ++count;
            }
            size_t padding = width > count ? width - count : 0;
            if (!left) for (size_t i = 0; i < padding; ++i) put(&out, ' ');
            for (size_t i = 0; i < count; ++i) put(&out, bytes ? (unsigned char)bytes[i] : wide[i]);
            if (left) for (size_t i = 0; i < padding; ++i) put(&out, ' ');
            continue;
        }
        char spec[32], rendered[8192];
        const char *modifier = "";
        if (length == H) modifier = "h";
        else if (length == HH) modifier = "hh";
        else if (length == L) modifier = "l";
        else if (length == LL) modifier = "ll";
        else if (length == J) modifier = "j";
        else if (length == Z) modifier = "z";
        else if (length == T) modifier = "t";
        else if (length != NONE && length != BIG_L) unsupported();
        if (strchr("fFeEgGaA", (char)conversion)) {
            if (length != NONE && length != L && length != BIG_L) unsupported();
            modifier = ""; /* MSVC long double is double. */
        } else if (length == BIG_L) unsupported();
        snprintf(spec, sizeof(spec), "%%%s*.*%s%c", flags, modifier, (char)conversion);
        int signed_width = left ? -width : width;
        int size = -1;
#define RENDER(type) snprintf(rendered, sizeof(rendered), spec, signed_width, precision, va_arg(args, type))
        if (conversion == 'd' || conversion == 'i') {
            if (length == LL) size = RENDER(long long);
            else if (length == L) size = RENDER(long);
            else if (length == J) size = RENDER(intmax_t);
            else if (length == Z || length == T) size = RENDER(ptrdiff_t);
            else size = RENDER(int);
        } else if (strchr("uoxX", (char)conversion)) {
            if (length == LL) size = RENDER(unsigned long long);
            else if (length == L) size = RENDER(unsigned long);
            else if (length == J) size = RENDER(uintmax_t);
            else if (length == Z || length == T) size = RENDER(size_t);
            else size = RENDER(unsigned int);
        } else if (strchr("fFeEgGaA", (char)conversion)) size = RENDER(double);
        else unsupported();
#undef RENDER
        if (size < 0 || (size_t)size >= sizeof(rendered)) unsupported();
        for (int i = 0; i < size; ++i) put(&out, (unsigned char)rendered[i]);
    }
    /* Legacy underscore CRT: exact fit has no terminator; truncation is -1. */
    if (out.length < capacity) buffer[out.length] = 0;
    return out.length > capacity ? -1 : (int)out.length;
}
