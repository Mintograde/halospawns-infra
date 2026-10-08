/* Private, bounded C-to-Rust transport. Not the public replay wire format. */
#ifndef HS_FILM_STREAM_H
#define HS_FILM_STREAM_H
#include <stdint.h>
#include <string.h>
#include <io.h>
#include <fcntl.h>

#define HS_FRAME_LIMIT (4u * 1024u * 1024u)
enum { HS_NULL, HS_FALSE, HS_TRUE, HS_I32, HS_U32, HS_F32, HS_F64,
       HS_STRING, HS_ARRAY, HS_OBJECT };
static unsigned char hs_buffer[HS_FRAME_LIMIT];
static uint32_t hs_used, hs_depth;
static struct { uint32_t offset, count; int object; } hs_stack[32];
static FILE *hs_output, *hs_copy;

static void hs_fail(const char *reason)
{
    fprintf(stderr, "h1-film-export: %s\n", reason);
    exit(3);
}

static void hs_bytes(const void *data, uint32_t size)
{
    if (size > HS_FRAME_LIMIT - hs_used) hs_fail("tick exceeds transport limit");
    memcpy(hs_buffer + hs_used, data, size);
    hs_used += size;
}

static void hs_byte(unsigned char value) { hs_bytes(&value, 1); }
static void hs_u32(uint32_t value) { hs_bytes(&value, 4); }
static void hs_text(const char *value)
{
    size_t length = strlen(value);
    if (length > 65536) hs_fail("string exceeds transport limit");
    hs_u32((uint32_t)length);
    hs_bytes(value, (uint32_t)length);
}

static void hs_item(const char *key)
{
    if (!hs_depth) return;
    if (hs_stack[hs_depth - 1].object) {
        if (!key) hs_fail("object value has no key");
        hs_text(key);
    } else if (key) hs_fail("array value has a key");
    ++hs_stack[hs_depth - 1].count;
}

static void hs_begin(const char *key, int object)
{
    hs_item(key);
    hs_byte(object ? HS_OBJECT : HS_ARRAY);
    if (hs_depth == 32) hs_fail("transport nesting limit");
    hs_stack[hs_depth].offset = hs_used;
    hs_stack[hs_depth].count = 0;
    hs_stack[hs_depth++].object = object;
    hs_u32(0);
}

static void hs_end(void)
{
    if (!hs_depth) hs_fail("unbalanced transport container");
    --hs_depth;
    memcpy(hs_buffer + hs_stack[hs_depth].offset, &hs_stack[hs_depth].count, 4);
}

static void hs_null(const char *key) { hs_item(key); hs_byte(HS_NULL); }
static void hs_bool(const char *key, int value) { hs_item(key); hs_byte(value ? HS_TRUE : HS_FALSE); }
static void hs_int(const char *key, int32_t value) { hs_item(key); hs_byte(HS_I32); hs_bytes(&value, 4); }
static void hs_uint(const char *key, uint32_t value) { hs_item(key); hs_byte(HS_U32); hs_u32(value); }
static void hs_float(const char *key, float value)
{
    if (!isfinite(value)) hs_fail("non-finite simulation value");
    hs_item(key); hs_byte(HS_F32); hs_bytes(&value, 4);
}
static void hs_double(const char *key, double value)
{
    if (!isfinite(value)) hs_fail("non-finite simulation value");
    hs_item(key); hs_byte(HS_F64); hs_bytes(&value, 8);
}
static void hs_string(const char *key, const char *value)
{
    hs_item(key); hs_byte(HS_STRING); hs_text(value ? value : "");
}

static void hs_flush_frame(FILE *diagnostic)
{
    if (hs_depth) hs_fail("unfinished transport container");
#ifdef __EMSCRIPTEN__
    extern void hs_wasm_emit(const void *data, uint32_t size);
    static int started;
    (void)diagnostic;
    if (!started) { hs_wasm_emit("HSFT0001", 8); started = 1; }
    hs_wasm_emit(&hs_used, 4);
    hs_wasm_emit(hs_buffer, hs_used);
#else
    if (!hs_output) {
        const char *handle = getenv("H1_EXPORT_HANDLE");
        const char *copy = getenv("H1_EXPORT_COPY");
        if (handle && *handle) {
            int fd = _open_osfhandle((intptr_t)_strtoui64(handle, NULL, 10), _O_BINARY | _O_WRONLY);
            if (fd < 0 || !(hs_output = _fdopen(fd, "wb"))) hs_fail("cannot open encoder pipe");
        } else {
            hs_output = diagnostic;
            if (_setmode(_fileno(hs_output), _O_BINARY) < 0) hs_fail("cannot set binary output");
        }
        setvbuf(hs_output, NULL, _IOFBF, 64 * 1024);
        if (copy && *copy) {
            hs_copy = fopen(copy, "wbx");
            if (!hs_copy) hs_fail("cannot create tick capture (must not exist)");
        }
        if (fwrite("HSFT0001", 1, 8, hs_output) != 8) hs_fail("pipe header write failed");
        if (hs_copy && fwrite("HSFT0001", 1, 8, hs_copy) != 8) hs_fail("capture header write failed");
    }
    if (fwrite(&hs_used, 4, 1, hs_output) != 1 || fwrite(hs_buffer, 1, hs_used, hs_output) != hs_used)
        hs_fail("encoder pipe closed or output write failed");
    if (hs_copy && (fwrite(&hs_used, 4, 1, hs_copy) != 1 || fwrite(hs_buffer, 1, hs_used, hs_copy) != hs_used))
        hs_fail("tick capture write failed");
#endif
    hs_used = 0;
}
#endif
