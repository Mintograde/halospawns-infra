#include <stdint.h>
#include <stdlib.h>
#include "headers/cache_file_globals.h"
#include "headers/blam_data_globals.h"

extern void cache_file_windows_thread_proc(void);
static int cache_thread;

void *CreateThread(void *attributes, uint32_t stack_size, uint32_t (*start)(void *),
                   void *param, uint32_t flags, uint32_t *thread_id) {
    (void)attributes; (void)stack_size;
    if (start != (uint32_t (*)(void *))cache_file_windows_thread_proc || param || flags) abort();
    if (thread_id) *thread_id = 1;
    return &cache_thread;
}

void hs_cache_wake(void *event) {
    if (event == cache_file_globals_0.sleep_event) cache_file_windows_thread_proc();
}
