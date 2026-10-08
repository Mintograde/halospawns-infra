#pragma once
#include <unistd.h>
#include <stdio.h>
#include <fcntl.h>
#define _fileno fileno
#define _fdopen fdopen
#define _O_BINARY 0
#define _O_WRONLY O_WRONLY
#define _chsize ftruncate
#define _access access
static inline int _setmode(int fd, int mode) { (void)fd; (void)mode; return 0; }
static inline int _open_osfhandle(intptr_t handle, int flags) { (void)flags; return (int)handle; }
