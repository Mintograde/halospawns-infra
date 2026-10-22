#pragma once
#include <windows.h>
typedef void *COMPRESSOR_HANDLE;
typedef void *DECOMPRESSOR_HANDLE;
#define COMPRESS_ALGORITHM_MSZIP 2
BOOL CreateCompressor(DWORD algorithm, void *allocation, COMPRESSOR_HANDLE *handle);
BOOL CreateDecompressor(DWORD algorithm, void *allocation, DECOMPRESSOR_HANDLE *handle);
BOOL Compress(COMPRESSOR_HANDLE handle, const void *input, SIZE_T size, void *output, SIZE_T room, SIZE_T *written);
BOOL Decompress(DECOMPRESSOR_HANDLE handle, const void *input, SIZE_T size, void *output, SIZE_T room, SIZE_T *written);
