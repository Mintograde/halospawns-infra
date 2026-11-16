# Positional heatmaps

The rollup worker retains every existing all/team and outcome metric block and
adds matched kill/death/presence inputs. A game enters the matched block only
when all three metrics are explicitly available, occupancy coverage is available,
and every selected participant has observed presence. Zero kills/deaths remain
valid. One source artifact read supplies ordinary, outcome, matched and region
aggregates. Counts and size limits include the new block.

API readers must support `halospawns.heatmapMatched.v1` before publishing this
worker. The API owns scoring and public cell limits; this worker never stores
scores. `20261116040000_heatmap_matched_presence.sql` invalidates derived scopes
and retains old generations. `20261116050000_heatmap_metric_coverage.sql` watches
changes to kill/death/presence availability for subsequent invalidation.
Rebuild through normal claims; do not reparse films
or mutate source facts. Keep compatible readers and all generations on rollback.

See API `docs/positional-heatmaps.md` for formulas, missing-data rules and the
versioned comparison response. Validation/deployment evidence belongs to handoff
`20261116-infra-api-svelte-positional-heatmaps` and `.build/heatmap-advantage/`.

Dev release: API 283 (`c33162f`, CI 43926796585), worker 12 (`6ec24ea`) and both
migrations are active. All 298 scopes are current, with matched data for 319
games / 30 populated maps. All old metric blocks and source/history fingerprints
remain. 37 packaged worker tests, 2,534 API CI tests, 10 PostgreSQL cases, frontend
tests/builds, 128 live comparison responses and 16 desktop/mobile views pass.
Health/DLQ and resource-free Terraform plans pass. Frontend stays local/uncommitted;
no H1 reparse or frontend/prod release occurred. See the handoff for exact evidence.
