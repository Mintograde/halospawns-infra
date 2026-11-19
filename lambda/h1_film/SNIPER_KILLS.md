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

## Recovering missing zoom and weapon evidence

Exporter 43 also accepts a shooter's recording whose complete simulation passed
its seed, hash and network checks but whose roster prevented viewer playback.
For a divergent recording, only actions followed by an original matching hash
sample before the first mismatch can qualify. The public replay keeps its
original track availability. A verified, separately uploaded Beta 5 shooter
film can supply the discharge for the matching actor, host bytes and map.

For a client-decided hit, the source engine can apply a report to a struck
object and deplete its parent body. The worker traces that same damage call
through depletion and kill credit. If the shooter's trigger report is missing,
the original accepted host report can still identify a unique collision in the
verified shooter's world by its client tick, owner, weapon, full object handles,
impact coordinates and direction. Conflicting discharge observations leave the
zoom unknown. A requested zoom level and the rendered camera's field of view
are distinct from the unit's zoom at the instant of firing.

Exporter 44 adds `recovered_weapons` to the sniper product. A credited kill
with no combat weapon ID can count when its lethal damage belongs uniquely to
the credited player's rifle in the map's damage graph. A complete traversal of
the rifle's paths can also exclude a non-rifle finisher. Cosmetic decals do not
deal damage. Shared damage tags and incomplete relevant paths cannot establish
a rifle kill. These checks preserve the original combat stream, and recovering
the weapon still requires separate shot evidence to classify zoom.

The 966 previously unknown zoom states spanned 171 games. For 428 kills the
host had no original shooter report, 239 lacked a usable accepted verdict,
and 24 had a report but no embedded shooter world. Another 194 had an exact
fire report on a track unavailable for playback, and 58 had a struck object
that differed from the body credited with the death. The remaining 23 were
Beta 4 damage-only kills without a link to the discharge.

Exporters 43 and 44 establish 205 of those zoom states. A verified shooter
track or verified prefix supplied 106, tracing the struck object's parent
supplied 57, matching the original impact supplied 37, and separately
uploaded Beta 5 recordings supplied five.

Exporter 45 can establish an unzoomed discharge after a client simulation
diverges. The original client must contain the trigger pull linked to the
host-accepted lethal report, with an unambiguous client clock and player.
The worker traces the same full body handle from a proven unzoomed state
through every recorded control up to that pull. A confirmed nonlethal injury
that clears both zoom fields can establish the starting state. It requires
the original client damage receipt and the matching injury network message.
The last independently verified state of the shooter's body can also establish
the start. Missing controls, a new zoom request, a body or control transition,
and ambiguous timing disqualify the proof. Four noscopes qualified through
injuries and a fifth through a verified prefix.

Of the original 966, 671 have no matching shooter recording at discharge
among the films attached in dev. Two additional local Beta 5 client files
contain four of these shots. All four occur after the first verification
mismatch in those files. Of the shots with an attached shooter film, 84
occur after a client simulation mismatch without enough original evidence
to establish zoom, and one occurs after the shooter's film ends.
Host playback can repeat or drop remote inputs. A client's requested zoom
level alone cannot establish the unit's actual zoom at discharge.

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

## Dev coverage follow-up on 2026-11-19

Worker/default `20261119-r3`, policy 42, and API 300 (`fbbf93c`, CI
44547047525) are active in dev. Beta 6–8 use exporter 45. The other four
host profiles use 44. The image retains all 112 exporters and prior recipes.
The release uses the existing database schema.

The first backfill selected 256 games. Four follow-up reparses established
five more noscopes across Downrush, Dread, Prisoner and Chillout. Three games
were in both passes, for 257 distinct games across 260 completed attempts.
The other 204 original games kept their selected artifacts and product hashes.
Every previously known zoom classification agrees with the selected result.
Of the original 966 unknowns, 190 were scoped and 20 were noscopes. All 455
previously unclassified killing weapons were resolved. Nineteen were sniper
kills with unknown zoom and 436 were other finishers. Across the 461 original
games there are now 4,655 recorded sniper kills, with 3,462 scoped, 418
unzoomed and 775 of unknown zoom.

| Default PB2 2v2, 366 games | Before | After |
| --- | ---: | ---: |
| Sniper kills | 3,688+ | 3,688 |
| Noscopes | 311+ | 330+ |
| Players with exact sniper totals | 39 of 104 | 104 of 104 |
| Players with exact noscope totals | 21 of 104 | 91 of 104 |
| Games with exact noscope totals | 124 of 366 | 294 of 366 |

In that cohort, 408 rifle kills still have unknown zoom. The player
leaderboards and map, gametype and player breakdowns reconcile to the dev
API totals. The local site passed desktop and mobile Chrome checks for exact
counts, lower bounds, rankings and source filters.

All other native analytics, scoreboard values, graphs and occupancy remained
identical. So did 50 standalone viewer files and all 22,276 payload entries
in 207 match files. Three separate Beta 5 shooter views were reattached with
identical bytes and original clocks. All six views are available through the
dev API and CDN with 428,941 frames and 3,578 verified hashes. Host finalization
and client attachment both validate the original host and independently frozen
shooter recording. One cached completion was redelivered to its original
attempt. One client reservation was retried with the same request ID.

All original history fingerprints are preserved. The database contains 510
conversions, 3,666 receipts, 3,209 host reprocess attempts, 474 map approvals
and 3,530 settings snapshots. Separate client history has 46 uploads and 47
attempts. The final image passed all 23 packaged cases, their 69 API callbacks,
the separate-client flow and seven retained recipes with 21 further callbacks.
All six dev Terraform plans have zero resource changes and the API output
refresh is applied. The worker inventory passed at activation and after the
backfill. The work queue and dead-letter queue were empty.
