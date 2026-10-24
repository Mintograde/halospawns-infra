#include <stddef.h>
#include <stdio.h>
#include "blampc_config.h"

int main(void)
{
#ifdef BLAMPC_FILM_RECORD_SIZE
    printf("options_size=%zu\n", (size_t)BLAMPC_FILM_RECORD_SIZE);
#else
    printf("options_size=%zu\n", sizeof(blampc_boot_options));
#endif
    printf("variant_size=%zu\n", sizeof(((blampc_boot_options *)0)->gametype_custom[0]));
    printf("shot_delay_aim_ms=%zu\n", offsetof(blampc_boot_options, shot_delay_aim_ms));
    printf("input_pipeline_ticks=%zu\n", offsetof(blampc_boot_options, input_pipeline_ticks));
    printf("aim_rate_hz=%zu\n", offsetof(blampc_boot_options, aim_rate_hz));
#ifdef H1_SETTINGS_BETA4
    printf("shot_aim_ahead_ticks=%zu\n", offsetof(blampc_boot_options, shot_aim_ahead_ticks));
#endif
    return 0;
}
