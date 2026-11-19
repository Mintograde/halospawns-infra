# Recorded player movement

Site heatmaps and the 3D map viewer animate measured player routes. A bright tip travels along a recorded curve on the replay clock. Speed controls color. Visits using similar directions in the same hallway make that direction more prominent. Top-down combines floors in projection. The registered isometric view and the depth-tested 3D layer retain elevation.

## Recorded paths

The API serves `halospawns.movementPaths.v1` when a client requests `representation=paths`. Each slot contributes consecutive same-life visits. A visit closes after four world units, three seconds or a break in source continuity. It carries up to one second of the preceding continuous path for its visible tail. The duration and distance totals count each core interval once.

The extractor simplifies in three dimensions against each original sample's time. The error budget is 1/128 world unit before quantizing coordinates to 1/512. The resulting bound is below 0.00951 world units against the linearly interpolated replay timeline. Encoding pins the first position, then stores elapsed time and coordinate deltas as signed varints in base64.

Each sparse row contains midpoint X/Y/Z in half-unit horizontal and quarter-unit vertical bins, entry heading, exit heading, length class, number of visits, total core time in 1/120 second, total travel in 1/4096 world unit, sample priority, approach time and packed geometry. There are 16 horizontal heading bins and two vertical bins. A deterministic distance-weighted sample retains one whole observed visit for each key. Scope builds merge the counts and select a representative from the contributing slots. Large selections pool the busiest compatible neighboring bins to cap each field at 8,192 rows. Opposite heading sectors stay separate. Counts, time and distance survive pooling.

The site and viewer also weight local directional support from adjacent bins. Sampling weight, pulse cadence and brightness reflect measured traffic. Every visible streak keeps the vertices and clock of one recorded visit. A browser worker prepares large selections and transfers static indexed ribbons to the renderer. Both WebGL views animate with a clock uniform and one draw for the layer. Narrow screens cap the mesh at 76,000 segments and larger screens at 165,000. Canvas 2D has a bounded fallback using the same measured curves. Pausing, offscreen visibility and reduced-motion preferences control animation.

Game and aggregate builds use the additional revision suffix `.paths1`. Old field reads and their immutable products remain available. The same source/roster changes and scheduled worker maintain both representations.

## Source and storage

The worker reads the selected, version-pinned replay. For a match container it verifies the index against the recorded manifest hash and range-reads the authoritative host world. It streams the viewer delta timeline and skips pose matrices. Original Xbox JSON, gzip and Zstandard recordings use a streaming reader. Workers release compressed input and temporary files after each game.

Only consecutive clock ticks for the same living player contribute. Match bounds, missing frames, object changes, deaths, hostman records, stationary samples and jumps outside the supported speed range break the measured path. For early Xbox recordings without body IDs, the source must provide a consistent slot, name and death count, living health, and a zero respawn timer. Velocities use the recorded clock. Positions use the same `(x, z, -y)` transform as the map geometry.

The original `representation=field` format uses one-world-unit cubic cells. Each cell has eight horizontal heading bins and two steep vertical bins. Opposite traffic keeps its direction, and routes on different floors retain their height. Each JSON row contains the following integers in order.

| Values | Units |
| --- | --- |
| Cell X, Y, Z and heading | Integer cell coordinates in viewer space, heading 0–9 |
| Moving time | 1/120 second |
| Total X, Y, Z displacement and path length | 1/4096 world unit |
| Total weighted X, Y, Z offsets inside the cell | 1/256 cell multiplied by moving time |

Every field is gzip-compressed and addressed by the SHA-256 of its decoded JSON. A game stores one field per moving slot. Aggregate builds read pages of 24 games, add these integer statistics, and publish reusable all-player, team, and outcome fields. The API returns the field references and the two map registrations. Clients verify decoded hashes and sizes. Changing projection reuses the field. Game participant selection and canonical player scopes use exact roster identities.

The first frontend used these cell velocities to advect up to 650 particles on the site and 760 in the viewer. Recorded-path clients request the time-ordered format above.

## Operations

Enable `movement_flow_enabled` in both dev `map-processing` and `app-api`. Apply the API repository's movement migrations, register its HMAC callback, and deploy the API through its CI workflow. Publish the Python worker and checksum-pinned Linux native extractor from the infra root.

```powershell
.venv/Scripts/python.exe scripts/publish-movement-worker.py
```

The publisher verifies the dev account, package hash and Lambda version before moving the existing alias. The scheduler polls every two minutes. Each invocation claims bounded work through the heatmap-processing HMAC client. An abandoned lease expires after eight minutes. The public reader selects exact source and scope revisions, and a stale lease cannot overwrite a newer attempt. New source selection, game eligibility, rosters and outcomes all feed normal invalidation. The error alarm is `halospawns-dev-movement-flow-errors`.

To pause generation, disable the movement schedule. Retain the three movement migrations, all product generations and the worker version that understands `.raw2` recording revisions. Existing replay and occupancy artifacts have independent readers and lifecycles.

## Recorded-path release on November 18, 2026

Dev API 293 (`5db5748`, CI `44444521311`) and movement worker 5 serve recorded paths for all 540 source games and all 298 aggregate scopes. The default PB2 2v2 cohort contains 356 games on 30 maps. The 2,293 new immutable products occupy 113.0 MiB compressed. The median populated all-player map is 382 KiB. The maximum is 959 KiB. PostgreSQL uses 1.68 MiB for all movement build generations and indexes.

All 2,170 contributing source slots matched their original moving times. All 150 populated aggregate selections matched independent sums of visits, time and travel. Every representative in all five Prisoner Pro selections traced back to an eligible source slot across 64 games. All 2,271 prior field references remain. Independent decoding of a legacy Xbox recording and the Chillout viewer world made 137,229 comparisons across 1,547 visits. Maximum position error was 0.00878 world units.

The 64-game field stores 63,236 visits in 8,192 rows. It displayed 3,988 measured curves and 106,696 segments on desktop, and 2,743 curves and 75,580 segments at the narrow-screen budget. Thirty warm PostgreSQL descriptor reads had a p95 execution time of 0.11 ms for a map and 0.15 ms for a game. The catalog rebuild completed in six minutes. Worker reports peaked at 233 MB. These measurements exclude API authentication and client transport.

WebGL checks on desktop and mobile viewports covered changing pixels, stable pause/reduced-motion states and stable geometry buffers. Both projections, game/team/participant filters, canonical empty results, combat heatmaps and the Canvas fallback were exercised. The local Chill Out Pro preview and audit outputs are in `.build/movement-paths/`.

Worker 5 has Lambda package SHA-256 `txcYelr60tpL4bustOm/bITI24QuxpYw7NOUCVtqwu0=`. All packaged files and the 231 deployed API Python sources were checked. The two-minute schedule is active. Health, alarm and queues passed. Keep both product formats, API 293 and the existing migrations available for readers. The frontend is local for testing.

## Original field verification on November 18, 2026

Dev API 292 is built from `3770ea9` by CI run `44443402415`. Its 231 Python files match the source. Worker version 4 has package SHA-256 `goKohg8gN6He8WnEBV+LzOYGjNY4ABSgclWVOl74LcM=` in Lambda's base64 format. Both deployed packages were verified against their source.

- All 540 selected recordings contain movement. The 488 viewer worlds and 52 original recordings produced 298 current aggregate builds. The default PB2 2v2 map cohort covers 356 games on 30 maps. There are currently no linked canonical-player appearances in this cohort.
- All 2,271 distinct current fields passed size, SHA-256, schema and row-count checks, covering 3,443,770 rows. An independent sum of every contributing slot reproduced all five selections for a 64-game map exactly.
- Current fields occupy 64.43 MiB compressed. PostgreSQL's build table and indexes including earlier generations occupy 872 KiB. The median all-player map field is 111.7 KiB compressed.
- The 373 multi-world sources held 51.58 GB of match objects. Their extracted host worlds totaled 9.76 GB, plus small index reads. Host extraction did not require a game re-simulation.
- On an 8,746-row field, 900 local Node samples with 760 particles gave a 0.08 ms p95 simulation update. Drawing and browser composition have separate costs. Chrome checks covered actual pixels, frozen and animated frames, projection reuse, filters, and the 3D draw on desktop and mobile viewports.
- Six packaged worker tests, isolated PostgreSQL selection and slot invalidation, 37 Terraform checks, API CI, both frontend builds and both frontend unit suites passed. The frontend is local for user testing.

The API repository documents route parameters and delivery states in `docs/movement-flow.md`. Local verification outputs are in `.build/movement-flow/`.
