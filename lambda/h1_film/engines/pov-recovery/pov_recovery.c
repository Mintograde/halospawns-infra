/* The worker writes this input only for a source-bound embedded-client retry.
 * The ordinary simulation still consumes its RNG and calculates spread. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint32_t key[5]; /* client tick, trigger, pellet, weapon tag, projectile tag */
    float direction[3];
} recorded_round;

static int initialized, enabled;
static uint32_t owner, count, matched, changed, rejected, rules_applied;
static float angles[4]; /* recorded client pair followed by host pair */
static recorded_round *rounds;
static unsigned char *used;
extern int blampc_film_client_view_playing(void);
extern int game_time_get(void);

static void report_recovery(void) {
    fprintf(stderr, "[pov-recovery] rules=%u rounds=%u matched=%u changed=%u rejected=%u\n",
            rules_applied,count,matched,changed,rejected);
}

static void initialize(void) {
    uint32_t header[3];
    FILE *file;
    if (initialized) return;
    initialized = 1;
    if (!getenv("H1_POV_RECOVERY")) return;
    file = fopen("pov-recovery.bin","rb");
    if (!file || fread(header,sizeof(header),1,file)!=1 || header[0]!=0x31564f50u ||
        header[1]>15 || header[2]>131072 || sizeof(recorded_round)!=32 ||
        fread(angles,sizeof(angles),1,file)!=1) abort();
    owner=header[1];
    count=header[2];
    if (count) {
        rounds=malloc(count*sizeof(*rounds));
        used=calloc(count,1);
        if (!rounds || !used || fread(rounds,sizeof(*rounds),count,file)!=count) abort();
    }
    if (fgetc(file)!=EOF || ferror(file) || fclose(file) || atexit(report_recovery)) abort();
    enabled=1;
}

int hs_pov_rules(float pistol,float sniper,float *host_pistol,float *host_sniper) {
    initialize();
    if (!enabled) return 0;
    if (!blampc_film_client_view_playing() || pistol!=angles[0] || sniper!=angles[1]) {
        rejected++;
        return 0;
    }
    *host_pistol=angles[2];
    *host_sniper=angles[3];
    rules_applied++;
    return 1;
}

static int compare_key(const void *left,const void *right) {
    const uint32_t *key=left;
    const recorded_round *row=right;
    for (int i=0;i<5;i++) {
        if (key[i]!=row->key[i]) return key[i]<row->key[i] ? -1 : 1;
    }
    return 0;
}

void hs_pov_round(int player,int trigger,int pellet,int weapon,int projectile,float *direction) {
    uint32_t key[5];
    const recorded_round *row;
    initialize();
    if (!enabled || player==-1 || ((uint32_t)player&65535u)!=owner) return;
    key[0]=(uint32_t)game_time_get();
    key[1]=(uint32_t)trigger;
    key[2]=(uint32_t)pellet;
    key[3]=(uint32_t)weapon;
    key[4]=(uint32_t)projectile;
    row=count ? bsearch(key,rounds,count,sizeof(*rounds),compare_key) : NULL;
    if (!row || used[row-rounds] || !blampc_film_client_view_playing()) {
        rejected++;
        return;
    }
    used[row-rounds]=1;
    matched++;
    if (memcmp(direction,row->direction,sizeof(row->direction))) {
        memcpy(direction,row->direction,sizeof(row->direction));
        changed++;
    }
}
