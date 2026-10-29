#pragma once
#include <unistd.h>
#define VK_SPACE 32
static inline long InterlockedIncrement(volatile long *value) { return ++*value; }
static inline long InterlockedExchange(volatile long *value, long next) { long old = *value; *value = next; return old; }
static inline unsigned long GetCurrentProcessId(void) { return (unsigned long)getpid(); }
