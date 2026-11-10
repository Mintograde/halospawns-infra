#pragma once
#include <unistd.h>
#include <stdlib.h>

#define MOVEFILE_REPLACE_EXISTING 1
#define CREATE_SUSPENDED 4
#define THREAD_PRIORITY_LOWEST (-2)
#define THREAD_PRIORITY_BELOW_NORMAL (-1)
#define ERROR_SHARING_VIOLATION 32
typedef struct { int unused; } CRITICAL_SECTION;
static inline void InitializeCriticalSection(CRITICAL_SECTION *s) { (void)s; }
static inline void EnterCriticalSection(CRITICAL_SECTION *s) { (void)s; }
static inline void LeaveCriticalSection(CRITICAL_SECTION *s) { (void)s; }
static inline void DeleteCriticalSection(CRITICAL_SECTION *s) { (void)s; }
static inline long InterlockedCompareExchange(volatile long *p,long next,long expected) { long old=*p;if(old==expected)*p=next;return old; }
/* Live recording/background maintenance is unavailable in the sequential worker. */
void *CreateThread(void *, uint32_t, uint32_t (*)(void *), void *, uint32_t, uint32_t *);
void *CreateEventA(void *, int, int, const char *);
int SetEvent(void *);
static inline int SetThreadPriority(void * h,int priority) { (void)h;(void)priority;return 0; }
static inline unsigned int ResumeThread(void * h) { (void)h;return 0xffffffffu; }
static inline void * GetCurrentThread(void) { return NULL; }
void blampc_net_host_restart_announce(void);
int blampc_net_lobby_host_tick_rate(void);
#define VK_SPACE 32
static inline long InterlockedIncrement(volatile long *value) { return ++*value; }
static inline long InterlockedExchange(volatile long *value, long next) { long old = *value; *value = next; return old; }
static inline unsigned long GetCurrentProcessId(void) { return (unsigned long)getpid(); }
/* There is no physical keyboard in a sequential film conversion. */
static inline int GetKeyboardState(unsigned char *keys) { memset(keys, 0, 256); return 1; }
