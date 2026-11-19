# Sniper kills and noscopes

Host exporter 42 adds `halospawns.h1SniperKills.v1` to native analytics. Its
`kills` array has one entry per credited enemy kill with the sniper rifle
weapon tag, in combat event order. Melee, suicides and betrayals are excluded.
Each entry names the combat event index, the zoom state at discharge and its
evidence source. Halo's unit zoom level is -1 when unzoomed and starts at 0
for the first magnification level.

For an engine-decided kill, the projectile and its damage effects carry the
shooter's zoom state from the successful discharge to the lethal damage. For
a client-decided kill, the worker joins the host damage application to its
accepted verdict, the original report and its explicitly linked trigger pull.
An available, verified recording of that client must reproduce a unique
discharge with the same engine clock, physical player and weapon tag. Film
playback can assign a different controller seat to the same physical player.
Missing, conflicting or ambiguous observations leave zoom unknown.

The private discharge observations are removed before encoding the replay
world. The worker and API both check that the new product covers the exact
ordered set of credited sniper kills. Ingestion writes small per-participant
counts and coverage flags for aggregate queries. Sniper totals can be complete
even when some shots have unknown zoom. The API returns a measured zero,
a confirmed minimum with incomplete coverage, or a null when no count is
available. Xbox scoreboard weapon-shot totals provide no killing-weapon or
zoom evidence. The local site displays incomplete counts with a plus sign.

All seven engine profiles retain their previous exporters and recipes.
Separate Beta 5 client uploads continue to use their retained client recipe.
Keep compatible API readers and the existing historical generations when
changing the worker default.

## Dev verification on 2026-11-19

Dev worker/default `20261118-r3`, policy 39, and API 295 (`d17718a`, CI
44462938572) provide aggregate sniper kills and shot-time noscopes. All seven
engine profiles and 95 exporters remain available. All 461 historical PB2 games
have selected audited generations. Of 4,636 confirmed sniper kills, 398 were fired
unzoomed, 3,272 were fired zoomed and 966 have unknown zoom. Missing weapon or
shot evidence yields explicit coverage and lower bounds.

The default PB2 2v2 statistics view contains 366 games. It reports 3,688 confirmed
sniper kills and 311 confirmed noscopes. The sum over players, maps and gametypes
matches both totals. Xbox-only totals are unavailable.

All prior native statistics, scoreboards, graphs, occupancy, 78 standalone replay
files and 39,119 payloads across 383 match files were verified. All six separate
client views retain their original viewer bytes and clocks (428,941 frames and
3,578 verified hashes). Every prior conversion, logical receipt, attempt, approval
and settings snapshot remains. Both frontend ranking options and the player and
aggregate Combat totals pass desktop/mobile Chrome checks. The frontend changes
remain local and uncommitted.

The seven native/WASM comparisons preserve shot evidence. Beta 3 retains its
existing one-ULP spawn-rating variation. All 23 packaged cases, 69 exact
deployed-API callbacks, the separate client flow and seven retained recipes pass.
API CI passed 2,860 tests. The final dev plans have zero resource actions and the
API output refresh is applied. The first candidate was superseded by the
physical-player discharge join. Candidate r2 retained the old five-minute
inventory limit. Its first and warm checks timed out before activation. The final
r3 image retains every r2 engine and encoder layer, checks four inventory entries
concurrently and passed its first live health check. Only r3 became the default.
The post-backfill worker inventory also passed, and the work queue and dead-letter
queue were empty. Keep the compatible API reader, all frozen recipes and archived
generations on rollback.

Dev retains 510 conversions, 3,406 logical receipts, 474 approvals and 3,270
settings snapshots. The private verification reports are under `.build/sniper/`.
