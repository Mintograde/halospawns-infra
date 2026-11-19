# Recorded player movement

The dev movement worker derives directional fields for site heatmaps and the 3D map viewer. A trail follows local measurements of player velocity. Its color shows average travel speed, and its moving bright end shows direction. The chance of seeding a trail in a cell is proportional to the recorded time players spent moving there.

## Source and storage

The worker reads the selected, version-pinned replay. For a match container it verifies the index against the recorded manifest hash and range-reads the authoritative host world. It streams the viewer delta timeline and skips pose matrices. Original Xbox JSON, gzip and Zstandard recordings use a streaming reader. Workers release compressed input and temporary files after each game.

Only consecutive clock ticks for the same living player contribute. Match bounds, missing frames, object changes, deaths, hostman records, stationary samples and jumps outside the supported speed range break the measured path. For early Xbox recordings without body IDs, the source must provide a consistent slot, name and death count, living health, and a zero respawn timer. Velocities use the recorded clock. Positions use the same `(x, z, -y)` transform as the map geometry.

The sparse field uses one-world-unit cubic cells. Each cell has eight horizontal heading bins and two steep vertical bins. Opposite traffic keeps its direction, and routes on different floors retain their height. Each JSON row contains the following integers in order.

| Values | Units |
| --- | --- |
| Cell X, Y, Z and heading | Integer cell coordinates in viewer space, heading 0–9 |
| Moving time | 1/120 second |
| Total X, Y, Z displacement and path length | 1/4096 world unit |
| Total weighted X, Y, Z offsets inside the cell | 1/256 cell multiplied by moving time |

Every field is gzip-compressed and addressed by the SHA-256 of its decoded JSON. A game stores one field per moving slot. Aggregate builds read pages of 24 games, add these integer statistics, and publish reusable all-player, team, and outcome fields. The API returns the field references and the two map registrations. Clients verify decoded hashes and sizes. Changing projection reuses the field. Game participant selection and canonical player scopes use exact roster identities.

The site batches 2D strokes and caps the visible layer at 650 particles. The viewer renders six segments per trail in a single WebGL draw, with 330 particles on narrow screens and 760 on desktop. Both renderers target 30 updates per second, honor reduced motion, and suspend animation offscreen or in a hidden tab.

## Operations

Enable `movement_flow_enabled` in both dev `map-processing` and `app-api`. Apply the API repository's movement migrations, register its HMAC callback, and deploy the API through its CI workflow. Publish the Python worker and checksum-pinned Linux native extractor from the infra root.

```powershell
.venv/Scripts/python.exe scripts/publish-movement-worker.py
```

The publisher verifies the dev account, package hash and Lambda version before moving the existing alias. The scheduler polls every two minutes. Each invocation claims bounded work through the heatmap-processing HMAC client. An abandoned lease expires after eight minutes. The public reader selects exact source and scope revisions, and a stale lease cannot overwrite a newer attempt. New source selection, game eligibility, rosters and outcomes all feed normal invalidation. The error alarm is `halospawns-dev-movement-flow-errors`.

To pause generation, disable the movement schedule. Retain both migrations, all product generations and the worker version that understands `.raw2` recording revisions. Existing replay and occupancy artifacts have independent readers and lifecycles.

## Dev verification on November 18, 2026

API 291 is built from `c459529` by CI run `44441769011`. Worker version 4 has package SHA-256 `goKohg8gN6He8WnEBV+LzOYGjNY4ABSgclWVOl74LcM=` in Lambda's base64 format.

- All 540 selected recordings contain movement. The 488 viewer worlds and 52 original recordings produced 298 current aggregate builds. The default PB2 2v2 map cohort covers 356 games on 30 maps. There are currently no linked canonical-player appearances in this cohort.
- All 2,271 distinct current fields passed size, SHA-256, schema and row-count checks, covering 3,443,770 rows. An independent sum of every contributing slot reproduced all five selections for a 64-game map exactly.
- Current fields occupy 64.43 MiB compressed. PostgreSQL's build table and indexes including earlier generations occupy 872 KiB. The median all-player map field is 111.7 KiB compressed.
- The 373 multi-world sources held 51.58 GB of match objects. Their extracted host worlds totaled 9.76 GB, plus small index reads. Host extraction did not require a game re-simulation.
- On an 8,746-row field, 900 local Node samples with 760 particles gave a 0.08 ms p95 simulation update. Drawing and browser composition have separate costs. Chrome checks covered actual pixels, frozen and animated frames, projection reuse, filters, and the 3D draw on desktop and mobile viewports.
- Six packaged worker tests, isolated PostgreSQL selection tests, API CI, both frontend builds and both frontend unit suites passed. The frontend is local for user testing.

The API repository documents route parameters and delivery states in `docs/movement-flow.md`. Local verification outputs are in `.build/movement-flow/`.
