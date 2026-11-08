# Host shot instrumentation study

Offline investigation of whether host simulation can substitute for missing
original client firing accounts in Beta 5/6 replays. This is **not a production
source adapter**. Its outputs are estimates and must never enter the verified
`pistol_three_shot_kills` definition, completion callbacks or published artifacts.

The permanent changes are this reproducible study and an ambiguity regression
test. None of the observation hooks are added to a registered engine. The
decision and measured results are in [HOST_SHOT_EVALUATION.md](../../HOST_SHOT_EVALUATION.md).

## Method

`prepare-port.mjs` archives a committed engine port into a new directory, then
patches only that copy. The archived upstream game source is also untouched.
Read-only hooks collect projectile origins/directions, collisions, termination
positions, and accepted host DEAL geometry. Each observation has the existing
host discharge or DEAL identity. A bounded private file holds the observations;
full viewer serialization is omitted from this experimental build.

`inventory.mjs` selects authoritative format-2/protocol-9818 Beta 5 or
format-3/protocol-9839 Beta 6 films. Existing strict readers validate containers
and client accounts. Exact host hashes deduplicate enriched copies; the copy
with the most uncapped firing accounts is preferred. Rejected inputs are logged.
Sources, maps, engine binaries and the production reducer are hash-bound in the
results. Whole recordings starting at tick zero are required.

`run.mjs` executes the native engine with up to three children by default.
It requires all recorded hashes, zero seed differences, zero refused network
applications, a clean verdict, the full tick count, and bounded gameplay data.
Recordings without a network verification summary are excluded from this
network study, even if their hashes match. Rejected evidence is retained.

`evaluate.mjs` compares each kill against the strict production reducer using
the original client firing accounts. The candidate receives **only host gameplay
and probe geometry**, never those accounts. A checked in-memory copy of the
reducer exposes decisions and disqualifying sequence gaps; its public result
must equal the unmodified reducer for every recording.

Five fixed candidate policies are compared:

- A unique preceding host discharge within 12 ticks (100 ms at 120 Hz).
- A unique host discharge within 12 ticks in either direction.
- The preceding policy plus a trajectory check: within 0.25 world units of the
  impact, at most 3 degrees direction difference, at least -0.05 forward distance.
- The preceding policy plus collision with the exact victim object handle.
- Both trajectory and collision checks.

Every policy requires the same participant and weapon tag, includes every host
firearm discharge when testing intervening shots, and prevents one discharge
from explaining different accepted DEALs. Geometry can reject a unique temporal
candidate, but cannot select among ambiguous candidates. Unresolved associations
remain unknown. Original local projectile lineage remains exact.

Results distinguish incorrect positives/negatives, abstentions, and predictions
where the original accounts cannot establish truth. Those last predictions are
**not additional verified kills**. `three_hit_with_miss` isolates encounters whose
three distinct hits are disqualified by an intervening discharge. The regression
in `associate.test.mjs` deliberately removes an original client miss from host
observations and demonstrates why all five policies can produce false positives.
Overlapping recordings of the same match are evaluated once, preferring the
longest verified recording, then the one with more original accounts.

## Reproduce on Windows

Run from the repository root with Node, CMake, MSVC x86 and the exact archived
upstream sources available. Keep outputs below an ignored build directory. New
preparation/inventory/report paths must not already exist. No AWS, API, database,
Python or frontend tools are needed.

```powershell
node lambda/h1_film/tools/host-shot-study/prepare-port.mjs --out .build/shot-study --ref 24fabfd

cmake -S .build/shot-study/port/lambda/h1_film/engines/beta6/native -B .build/shot-study/native-beta6 -A Win32 -DH1_SOURCE=<beta6-source-directory> -DH1_COMBAT_EXPORT=ON -DH1_GAMEPLAY_EXPORT=ON -DH1_DAMAGE_ATTRIBUTION=ON -DH1_DAMAGE_ATTRIBUTION_V2=ON -DH1_CLIENT_VIEW=ON -DH1_NETWORK_REPLAY_FIXES=ON
cmake --build .build/shot-study/native-beta6 --config Release --target blampc --parallel 12

node lambda/h1_film/tools/host-shot-study/inventory.mjs --films <film-directory> --maps <map-directory> --family beta6 --out .build/shot-study/inventory.json --exploration lambda/h1_film/tools/host-shot-study/20261108-exploration.json
node lambda/h1_film/tools/host-shot-study/run.mjs --inventory .build/shot-study/inventory.json --engine .build/shot-study/native-beta6/engine/Release/h1-film-export.exe --out .build/shot-study/run
node lambda/h1_film/tools/host-shot-study/evaluate.mjs --results .build/shot-study/run/results.json --out .build/shot-study/report.json

node --test lambda/h1_film/tests/gameplay-source.test.mjs lambda/h1_film/tests/gameplay-metrics.test.mjs lambda/h1_film/tools/host-shot-study/associate.test.mjs
```

For Beta 5, substitute `beta5` for `beta6` and use its source archive. The native
CMake entrypoints enforce upstream commits `fbbfae27` and `86c52285`, respectively.
Add `--extra <film>` to inventory for each retained source outside the film
directory. The November 8 run additionally included the four retained dev
sources for Seizen, Dammy, Hang 'Em High and Downrush, plus the retained Beta 5
Dread source. Full source hashes are in the result record.

The exploration list identifies the seven recordings examined before fixing
the 12-tick/geometry candidates. Split by **host hash or match identity**, not
the enriched outer-file hash: adding accounts must not turn an already examined
match into new validation evidence. Do not tune policies against the validation
set and continue describing that same set as an independent check.

Native state hashes validate simulation; they do not certify a candidate's shot
associations. Before extending the probe, also compare control gameplay, deaths,
weapons, roster and match end with an existing verified conversion, as done for
the Seizen source in this study. Never publish these reduced native dumps as
viewer artifacts or register this diagnostic binary as an exporter.
