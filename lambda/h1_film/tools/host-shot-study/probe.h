/* Experiment only: read-only geometry observations, outside every shipped port. */
extern int game_time_get(void);
static FILE *hs_probe_file;
static int hs_probe_initialized;
static unsigned int hs_probe_records;
static int hs_probe_open(void)
{
    if (!hs_probe_initialized) {
        const char *path = getenv("HS_HOST_SHOT_PROBE_FILE");
        hs_probe_initialized = 1;
        if (!path || !*path) return 0;
        hs_probe_file = fopen(path, "wb");
        if (!hs_probe_file) hs_fail("cannot open host shot experiment output");
        setvbuf(hs_probe_file, NULL, _IOFBF, 262144);
    }
    if (!hs_probe_file) return 0;
    if (++hs_probe_records > 1000000) hs_fail("host shot experiment record cap");
    return 1;
}
static void hs_probe_vector(const char *key, const float *v)
{
    int i;
    fprintf(hs_probe_file, ",\"%s\":[", key);
    for (i = 0; i < 3; ++i) {
        if (i) fputc(',', hs_probe_file);
        if (v && isfinite(v[i])) fprintf(hs_probe_file, "%.9g", v[i]);
        else fputs("null", hs_probe_file);
    }
    fputc(']', hs_probe_file);
}
static void hs_probe_start(const char *event, int projectile, hs_lineage lineage)
{
    fprintf(hs_probe_file, "{\"event\":\"%s\",\"clock\":%d,\"projectile\":%d,\"shot\":%u,\"physical\":%d,\"slot\":%d",
        event, game_time_get(), projectile, lineage.shot,
        lineage.owner == -1 ? -1 : (unsigned short)lineage.owner, hs_slot(lineage.owner));
}
extern void hs_probe_original_projectile(int, int, int, int, int);
void blampc_shot_ledger_projectile(int projectile, int owner, int weapon, int trigger, int tag_index)
{
    hs_lineage lineage;
    object_header_datum *header;
    hs_probe_original_projectile(projectile, owner, weapon, trigger, tag_index);
    lineage = hs_bound(hs_projectiles, projectile);
    header = lookup(projectile, 5);
    if (!lineage.shot || !header || !hs_probe_open()) return;
    hs_probe_start("round", projectile, lineage);
    fprintf(hs_probe_file, ",\"weapon_tag\":%u,\"trigger\":%d", (unsigned int)tag_index, trigger);
    hs_probe_vector("origin", header->datum->object.position.n);
    hs_probe_vector("direction", header->datum->object.forward.n);
    fputs("}\n", hs_probe_file);
}
static void hs_probe_collision(int projectile, const collision_result *collision)
{
    hs_lineage lineage = hs_bound(hs_projectiles, projectile);
    object_header_datum *target;
    int victim = -1;
    if (!lineage.shot || !collision || !hs_probe_open()) return;
    target = lookup(collision->object_index, 0);
    if (target) {
        int player = player_index_from_unit_index(collision->object_index);
        victim = player == -1 ? -1 : (unsigned short)player;
    }
    hs_probe_start("collision", projectile, lineage);
    fprintf(hs_probe_file, ",\"type\":%d,\"object\":%d,\"victim\":%d,\"node\":%d,\"material\":%d",
        collision->type, collision->object_index, victim, collision->node_index, collision->material_type);
    hs_probe_vector("impact", collision->point.n);
    fputs("}\n", hs_probe_file);
}
static void hs_probe_end(int projectile, const float *point)
{
    hs_lineage lineage = hs_bound(hs_projectiles, projectile);
    if (!lineage.shot || !hs_probe_open()) return;
    hs_probe_start("end", projectile, lineage);
    hs_probe_vector("point", point);
    fputs("}\n", hs_probe_file);
}
extern void hs_probe_original_detonation(int, const float *);
void blampc_shot_ledger_detonation(int projectile, const float *point)
{
    hs_probe_end(projectile, point);
    hs_probe_original_detonation(projectile, point);
}
extern void hs_probe_original_deleted(int);
void blampc_shot_ledger_deleted(int object)
{
    object_header_datum *header = lookup(object, 5);
    if (header) hs_probe_end(object, header->datum->object.position.n);
    hs_probe_original_deleted(object);
}
static void hs_probe_deal(unsigned int deal, const damage_data *damage, int object)
{
    if (!hs_probe_open()) return;
    fprintf(hs_probe_file, "{\"event\":\"deal\",\"clock\":%d,\"deal\":%u,\"physical\":%d,\"object\":%d,\"damage_tag\":%u",
        game_time_get(), deal, damage->owner_player_index == -1 ? -1 : (unsigned short)damage->owner_player_index,
        object, (unsigned int)damage->definition_index);
    hs_probe_vector("origin", damage->origin.n);
    hs_probe_vector("direction", damage->direction.n);
    hs_probe_vector("impact", damage->epicenter.n);
    fputs("}\n", hs_probe_file);
}
