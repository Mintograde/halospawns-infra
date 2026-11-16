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
and retains old generations. Rebuild through normal claims; do not reparse films
or mutate source facts. Keep compatible readers and all generations on rollback.

See API `docs/positional-heatmaps.md` for formulas, missing-data rules and the
versioned comparison response. Validation/deployment evidence belongs to handoff
`20261116-infra-api-svelte-positional-heatmaps` and `.build/heatmap-advantage/`.
