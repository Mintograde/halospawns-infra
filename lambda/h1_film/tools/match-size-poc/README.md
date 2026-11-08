# Beta 6 match compression experiment

This is an offline implementation and benchmark, not a registered replay
contract or a deployed worker change. The current recipes and readers remain
unchanged. The experimental files live under `.build/beta6-size-study/`.

The recommended first step is **lossless removal of reconstructible copies**.
It reduces complete files by 54–59% with about 1–3 seconds of additional local
packing work. It does not reach the requested approximately 80% target.

## Complete file results

All samples are existing, verified exporter-16/viewer-7 conversions of the
November 7 films. Each has five playable worlds; Dread and Prisoner also retain
one explicitly unavailable client's diagnostics. MB below are decimal.

| Match | Original | Compact | Reduction |
| --- | ---: | ---: | ---: |
| Octagon, 15:30:56 | 177.04 MB | 72.59 MB | 59.00% |
| Dread, 15:39:11 | 352.86 MB | 161.24 MB | 54.30% |
| Prisoner, 15:51:10 | 373.61 MB | 165.28 MB | 55.76% |

The **entire original container** is reconstructed byte-for-byte and checked
against its SHA-256. This includes original compressed records, all clocks,
unavailable-client evidence, every diagnostic table, controller inputs, all
world bytes and all existing pose precision. Nothing is moved to a separate
download or removed from the retained data. Every source entry is hash-checked
before packing.

The unchanged `openMatchReplay` reader also reads all original entries through
the virtual range adapter successfully. Reverse-order cold range checks cover
all 332 entries across the three files. A 4 KiB world request still fetches
4 KiB; world data is neither recompressed nor dependent on other perspectives.
The largest observed cold diagnostic-table request fetches about 0.84 MB of
underlying account data. Local timing and memory figures, source/output hashes,
and complete pose totals are in [RESULTS.json](RESULTS.json).

Timings measure Node 24 on this Windows workstation, reading retained exports
from memory. They are not Lambda timings or browser render benchmarks. The
full readback verification is timed separately. Original film simulation and
conversion are not rerun by this repacker.

## Layout and reader

`compact.mjs` writes `H1MCPOC1`, a deliberately experimental outer container:

- The old header and manifest are preserved exactly in a compressed index.
- Already-compressed world entries retain identity storage and their original
  internal range boundaries and hashes.
- Other original entries use independent 256 KiB zstd blocks, falling back to
  identity storage when compression is larger.
- Expanded FNET records become virtual ranges over the original FNET blocks.
  The existing MSZIP/column decoder reconstructs only the overlapping blocks.
- Extracted diagnostic tables become references into the original account or
  ledger; expanded PAD events/samples reference the original PAD section.
- Dependencies are one level deep. The reader has a 32 MiB byte-bounded LRU
  cache and validates source manifests, source/entry bounds and dependencies.

`readSourceRange` presents the original file to existing readers. Integrity of
partial identity-world ranges continues to use the original world's index and
chunk hashes; whole-entry reads check the original entry hash. This prototype
uses Node Buffer, zstd and the existing Node source decoders. A browser port
must provide the equivalent bounded, scheduled decoders; the prototype is not
already wired into the frontend.

## Other approaches measured

### Sharing world positions with a tick offset

In a Dread segment covering frames 32,768–40,959, a search of offsets -240 to
+240 frames compared exact XYZ values every four ticks. Across four available
clients and player slots 0–3, fifteen pairs' best equality rates were below 8%;
one reached 43.5%. Exact results are in [ALIGNMENT.json](ALIGNMENT.json).
This is a limited sample, not a whole-corpus statement or
proof of optimal clock alignment. It is enough to reject silently substituting
a single shifted host world. Client prediction/corrections must be preserved.

### Shared skeletal poses

`pose-pool.mjs` shares **exact quantized bone states**, without assuming world
positions match. Dictionaries are independent for each group of 2,048-frame
chunks. Every original pose-wire byte is restored, including modes, topology,
run boundaries and raw fallbacks. All 1,068,591 playable-world ticks were
covered by full round-trip checks.

| Match | Original pose payload | Shared payload | Pose reduction | Local pack time |
| --- | ---: | ---: | ---: | ---: |
| Octagon | 20.44 MB | 19.02 MB | 6.94% | 8.48 s |
| Dread | 44.40 MB | 31.30 MB | 29.51% | 14.11 s |
| Prisoner | 43.32 MB | 29.44 MB | 32.03% | 13.81 s |

These are complete **pose payload** results, including pool metadata and
references, not sizes of new complete match containers. They are separate from
the recommended compact artifacts above. Actual shared pose blocks and their
per-world bindings are retained in the ignored `*-worlds` directories. A seek
would load the group's shared dictionary; its cost grows with view count.
The reduction amounts to only 0.8–3.7% of the original whole-file size, so it
does not bridge the gap to 80% by itself.

### Columnar world state

`columns.mjs` transposes exact fields, uses object IDs to avoid object-list
churn, and selects lossless float predictors. Forty-five first/middle/last
chunks were decoded and verified field-for-field, including float bit
semantics. Aggregate sampled base-payload reductions were 37.7%, 44.1% and
42.2% for Octagon, Dread and Prisoner respectively. These exclude poses and
other match entries and must not be quoted as whole-file savings.

The JavaScript prototype averages roughly 0.5–0.7 seconds of encoding per
sampled chunk and 0.2–0.3 seconds of decoding. That is an unattractive cost
against the measured fast repack. A native encoder integrated with the existing
stream could avoid this prototype's decode/transposition overhead, but no such
speedup is claimed. Simple byte-plane repacking of existing pose varints made
the sampled pose payloads larger and was rejected.

No approximate world codec, reduced tick rate, diagnostic removal, or pose
precision change is selected. Getting close to 80% would require additional
world-codec improvements or a separately measured fidelity/processing tradeoff.
The present measurements do not establish that 80% is impossible.

## Reproduce

Use an existing verified match replay `.hsrv`; the tools never mutate it.

```powershell
node --test lambda/h1_film/tools/match-size-poc/compact.test.mjs lambda/h1_film/tests/match-replay.test.mjs
node --max-old-space-size=2048 lambda/h1_film/tools/match-size-poc/benchmark.mjs SOURCE.hsrv OUTPUT.h1mc
node --max-old-space-size=2048 lambda/h1_film/tools/match-size-poc/inspect-worlds.mjs SOURCE.hsrv PATH_TO_SVELTE_REPO OUTPUT_DIRECTORY
node lambda/h1_film/tools/match-size-poc/inspect-alignment.mjs SOURCE.hsrv PATH_TO_SVELTE_REPO ALIGNMENT_OUTPUT.json
```

Outputs use exclusive creation. To benchmark an existing, identical candidate
without overwriting it, append a fresh report path and `verify-existing` to the
benchmark command. `inspect-worlds.mjs` uses the existing Svelte delta decoder
to independently read the source base stream. Its pose pool experiment is
bounded to 64 MiB raw groups and has been measured on five playable views,
not all sixteen possible clients.

## Production integration still required

Do not change viewer-7 bytes or repin old attempts. Freeze a new append-only
format/recipe only after the physical/virtual range contract is reviewed. The
producer, Python finalizer/API artifact bounds, browser loader, capability
catalogue, and range/hash tests must agree on physical file size versus logical
decoded ranges. Port the required source block decoders to the browser with
bounded allocation, scheduling and cancellation. Run actual browser cold seeks
and multi-perspective playback before activating a new default.

The fast container is the recommended production starting point. Shared poses
and columnar worlds remain separate experiments, rather than unmeasured
dependencies of that rollout. No API, frontend, AWS, queue, job, migration,
release registration, default, or existing source artifact was changed here.
