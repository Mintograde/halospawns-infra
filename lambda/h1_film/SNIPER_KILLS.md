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
