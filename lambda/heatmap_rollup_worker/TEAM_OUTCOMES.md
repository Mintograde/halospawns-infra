# Team outcome heatmaps

The spatial worker keeps every existing all/team metric and additionally builds
`team_outcomes` with schema `halospawns.heatmapTeamOutcomes.v1`. Winning/losing
partitions are resolved per game, never from a team color after merging games.
Each partition carries all three metrics and its own selected/contributing
game/participant counts. Player/map scopes only contain the selected player's
appearances. Unassigned participants do not become losers.

The API input supplies `winning_team_index`, including explicit null for draws,
unknown results, unfinished games and FFA. The API validates team mode, observed
ending, simulation completion and the whole non-hostman roster before narrowing
player scope. Missing result fields are rejected instead of silently generating
empty outcome partitions from an older API.

Each source occupancy artifact is loaded once. Outcome cells count against the
existing output/cell limits. Region calculations, event/voxel projection,
immutable generations, source-revision fencing and the normal bounded scheduler
remain unchanged. No replay reparse is required.

Deploy the additive API reader/input contract before this worker. Then apply
API migration `20261116030000_heatmap_team_outcomes.sql` to watch result changes
and dirty existing scopes. Retain all old generations. Older strict readers
reject the nested block, so keep the compatible API reader on rollback; never
roll the input API back beneath the new worker. Older artifacts remain readable
for all/team views and explicitly report outcome aggregation pending.

See API `docs/heatmap-team-outcomes.md` and cross-repo handoff
`20261116-infra-api-svelte-heatmap-team-outcomes` for rollout evidence. Local
audit tools/results live under `.build/heatmap-outcomes/`.
