#include <stdint.h>
#include <string.h>
#include <zlib.h>
#include "compressapi.h"

static uint32_t read_word(const unsigned char *bytes) {
    return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 | (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

BOOL CreateCompressor(DWORD algorithm, void *allocation, COMPRESSOR_HANDLE *handle) {
    (void)algorithm; (void)allocation; *handle = NULL; return FALSE;
}

BOOL Compress(COMPRESSOR_HANDLE handle, const void *input, SIZE_T size, void *output, SIZE_T room, SIZE_T *written) {
    (void)handle; (void)input; (void)size; (void)output; (void)room; *written = 0; return FALSE;
}

BOOL CreateDecompressor(DWORD algorithm, void *allocation, DECOMPRESSOR_HANDLE *handle) {
    (void)allocation;
    *handle = algorithm == COMPRESS_ALGORITHM_MSZIP ? (void *)1 : NULL;
    return *handle != NULL;
}

BOOL Decompress(DECOMPRESSOR_HANDLE handle, const void *input, SIZE_T size, void *output, SIZE_T room, SIZE_T *written) {
    const unsigned char *bytes = input;
    unsigned char *decoded = output;
    *written = 0;
    if (!handle || size < 24 || memcmp(bytes, "\x0a\x51\xe5\xc0", 4)
        || bytes[4] != 24 || bytes[5] || bytes[7] != 2 || read_word(bytes + 12) || read_word(bytes + 20)) return FALSE;
    const uint32_t expected = read_word(bytes + 8), chunk = read_word(bytes + 16);
    if (!expected || expected > room || chunk != (expected < 32768 ? expected : 32768)) return FALSE;
    unsigned char header[23];
    memcpy(header, bytes, 6);
    memcpy(header + 6, bytes + 7, 17);
    if ((crc32(0, header, sizeof header) & 255) != bytes[6]) return FALSE;
    size_t offset = 24, produced = 0;
    while (produced < expected) {
        if (size - offset < 6) return FALSE;
        const uint32_t packed = read_word(bytes + offset);
        offset += 4;
        if (packed < 2 || packed > size - offset || bytes[offset] != 'C' || bytes[offset + 1] != 'K') return FALSE;
        const uint32_t wanted = expected - produced < chunk ? expected - produced : chunk;
        z_stream stream = {0};
        if (inflateInit2(&stream, -15) != Z_OK) return FALSE;
        if (produced) {
            const uint32_t history = produced < 32768 ? produced : 32768;
            if (inflateSetDictionary(&stream, decoded + produced - history, history) != Z_OK) {
                inflateEnd(&stream); return FALSE;
            }
        }
        stream.next_in = (unsigned char *)bytes + offset + 2;
        stream.avail_in = packed - 2;
        stream.next_out = decoded + produced;
        stream.avail_out = wanted;
        const int result = inflate(&stream, Z_FINISH);
        const int valid = result == Z_STREAM_END && stream.total_out == wanted && stream.avail_in == 0;
        inflateEnd(&stream);
        if (!valid) return FALSE;
        produced += wanted;
        offset += packed;
    }
    if (offset != size) return FALSE;
    *written = produced;
    return TRUE;
}
