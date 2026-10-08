#pragma once
#include <stddef.h>
#include <stdint.h>
#include <wchar.h>
typedef void *HANDLE;
typedef void *HWND;
typedef void *HMODULE;
typedef void *LPVOID;
typedef const void *LPCVOID;
typedef const char *LPCSTR;
typedef char *LPSTR;
typedef unsigned int DWORD;
typedef int LONG;
typedef unsigned int ULONG;
typedef unsigned short WORD;
typedef unsigned char BYTE;
typedef unsigned int UINT;
typedef long long LONGLONG;
typedef int BOOL;
typedef size_t SIZE_T;
typedef struct { DWORD dwLowDateTime, dwHighDateTime; } FILETIME;
typedef union { struct { DWORD LowPart; LONG HighPart; }; long long QuadPart; } LARGE_INTEGER;
typedef union { struct { DWORD LowPart, HighPart; }; unsigned long long QuadPart; } ULARGE_INTEGER;
typedef struct { WORD wYear, wMonth, wDayOfWeek, wDay, wHour, wMinute, wSecond, wMilliseconds; } SYSTEMTIME;
typedef struct { DWORD dwFileAttributes; FILETIME ftCreationTime, ftLastAccessTime, ftLastWriteTime;
    DWORD nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1; char cFileName[260], cAlternateFileName[14]; } WIN32_FIND_DATAA;
typedef struct { DWORD dwFileAttributes; FILETIME ftCreationTime, ftLastAccessTime, ftLastWriteTime;
    DWORD nFileSizeHigh, nFileSizeLow; } WIN32_FILE_ATTRIBUTE_DATA;
typedef struct { uintptr_t Internal, InternalHigh; DWORD Offset, OffsetHigh; HANDLE hEvent; } OVERLAPPED;
typedef struct { DWORD dwLength, dwMemoryLoad; unsigned long long ullTotalPhys, ullAvailPhys,
    ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual; } MEMORYSTATUSEX;
typedef struct { DWORD dwLength, dwMemoryLoad, dwTotalPhys, dwAvailPhys,
    dwTotalPageFile, dwAvailPageFile, dwTotalVirtual, dwAvailVirtual; } MEMORYSTATUS;
#define TRUE 1
#define FALSE 0
#define WINAPI
#define MAX_PATH 260
#define INVALID_HANDLE_VALUE ((HANDLE)-1)
#define INVALID_FILE_ATTRIBUTES 0xffffffffu
#define INVALID_FILE_SIZE 0xffffffffu
#define INVALID_SET_FILE_POINTER 0xffffffffu
#define GENERIC_READ 0x80000000u
#define GENERIC_WRITE 0x40000000u
#define FILE_SHARE_READ 1
#define FILE_SHARE_WRITE 2
#define FILE_SHARE_DELETE 4
#define CREATE_NEW 1
#define CREATE_ALWAYS 2
#define OPEN_EXISTING 3
#define OPEN_ALWAYS 4
#define TRUNCATE_EXISTING 5
#define FILE_BEGIN 0
#define FILE_CURRENT 1
#define FILE_END 2
#define FILE_ATTRIBUTE_NORMAL 0x80
#define FILE_ATTRIBUTE_DIRECTORY 0x10
#define FILE_ATTRIBUTE_READONLY 1
#define FILE_FLAG_OVERLAPPED 0x40000000u
#define FILE_FLAG_SEQUENTIAL_SCAN 0x08000000u
#define FILE_FLAG_NO_BUFFERING 0x20000000u
#define FILE_FLAG_RANDOM_ACCESS 0x10000000u
#define FILE_FLAG_WRITE_THROUGH 0x80000000u
#define FILE_WRITE_ATTRIBUTES 0x100
#define FILE_READ_ATTRIBUTES 0x80
#define ERROR_SUCCESS 0
#define ERROR_FILE_NOT_FOUND 2
#define ERROR_PATH_NOT_FOUND 3
#define ERROR_ALREADY_EXISTS 183
#define ERROR_IO_PENDING 997
#define ERROR_HANDLE_EOF 38
#define NO_ERROR 0
#define INFINITE 0xffffffffu
#define WAIT_OBJECT_0 0
#define WAIT_TIMEOUT 258
#define WAIT_ABANDONED 128
#define GMEM_MOVEABLE 2
#define MEM_COMMIT 0x1000
#define MEM_RESERVE 0x2000
#define MEM_RELEASE 0x8000
#define PAGE_READWRITE 4
#define HEAP_ZERO_MEMORY 8
#define CP_UTF8 65001
#define WC_ERR_INVALID_CHARS 0x80
#define GetFileExInfoStandard 0
#define LOCALE_USER_DEFAULT 0x0400
#define LOCALE_SLIST 0x000c
int GetLocaleInfoA(DWORD, DWORD, char *, int);
HANDLE CreateFileA(const char *, DWORD, DWORD, void *, DWORD, DWORD, HANDLE);
BOOL CloseHandle(HANDLE);
BOOL ReadFile(HANDLE, void *, DWORD, DWORD *, OVERLAPPED *);
BOOL WriteFile(HANDLE, const void *, DWORD, DWORD *, OVERLAPPED *);
DWORD SetFilePointer(HANDLE, LONG, LONG *, DWORD);
BOOL SetFilePointerEx(HANDLE, LARGE_INTEGER, LARGE_INTEGER *, DWORD);
DWORD GetFileSize(HANDLE, DWORD *);
BOOL GetFileSizeEx(HANDLE, LARGE_INTEGER *);
BOOL GetFileTime(HANDLE, FILETIME *, FILETIME *, FILETIME *);
BOOL SetFileTime(HANDLE, const FILETIME *, const FILETIME *, const FILETIME *);
BOOL SetEndOfFile(HANDLE);
BOOL FlushFileBuffers(HANDLE);
DWORD GetFileAttributesA(const char *);
BOOL GetFileAttributesExA(const char *, int, void *);
BOOL SetFileAttributesA(const char *, DWORD);
DWORD GetLastError(void);
void SetLastError(DWORD);
BOOL CreateDirectoryA(const char *, void *);
BOOL DeleteFileA(const char *);
BOOL MoveFileExA(const char *, const char *, DWORD);
HANDLE FindFirstFileA(const char *, WIN32_FIND_DATAA *);
BOOL FindNextFileA(HANDLE, WIN32_FIND_DATAA *);
BOOL FindClose(HANDLE);
void GetLocalTime(SYSTEMTIME *);
BOOL FileTimeToSystemTime(const FILETIME *, SYSTEMTIME *);
BOOL FileTimeToLocalFileTime(const FILETIME *, FILETIME *);
int CompareFileTime(const FILETIME *, const FILETIME *);
void *VirtualAlloc(void *, unsigned int, unsigned int, unsigned int);
BOOL VirtualFree(void *, unsigned int, unsigned int);
BOOL VirtualProtect(void *, size_t, DWORD, DWORD *);
BOOL GlobalMemoryStatusEx(MEMORYSTATUSEX *);
void GlobalMemoryStatus(MEMORYSTATUS *);
void *GlobalAlloc(UINT, size_t);
void *GlobalReAlloc(void *, size_t, UINT);
void *LocalFree(void *);
HANDLE GetProcessHeap(void);
void *HeapAlloc(HANDLE, DWORD, size_t);
void *HeapReAlloc(HANDLE, DWORD, void *, size_t);
BOOL HeapFree(HANDLE, DWORD, void *);
DWORD WaitForSingleObject(HANDLE, DWORD);
BOOL ReleaseMutex(HANDLE);
int WideCharToMultiByte(UINT, DWORD, const wchar_t *, int, char *, int, const char *, BOOL *);
int MultiByteToWideChar(UINT, DWORD, const char *, int, wchar_t *, int);
BOOL QueryPerformanceCounter(LARGE_INTEGER *);
BOOL QueryPerformanceFrequency(LARGE_INTEGER *);
DWORD GetTempPathA(DWORD, char *);
UINT GetTempFileNameA(const char *, const char *, UINT, char *);
DWORD GetTickCount(void);
void Sleep(DWORD);
