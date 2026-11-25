# Full-fidelity replay encoding

The November 25 local candidate reduced six complete viewer files from **651,990,242 to 595,922,580 bytes**, saving **56,067,662 bytes (8.60%)** against worker `20261125-r1`. Including the 214,902-byte Beta 5 diagnostic sidecar and all six spatial occupancy artifacts, the totals are 652,316,825 and 596,249,163 bytes. Every sidecar and occupancy SHA-256 matched. The 80% size target would require the viewer files to fit in 130.4 MB.

## Measurements

Each run starts from the same recorded film and raw map. The packaged Linux worker performs inspection, host and client simulation, encoding, assembly, storage and the first completion callback. The benchmark uses 3,008 MiB and 1.700396 vCPUs per worker, with up to eight independently constrained client workers. The local harness implements versioned object storage, Lambda invocation and the API callback. It excludes AWS network latency, image hydration and parent initialization. Reported file sizes include the replay indexes and every embedded diagnostic.

| Film | Recorded Hz | Views | Released time | Candidate time | Time saved | Released MB | Candidate MB | Size saved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Worthy | 120 | 5 | 20.22 s | 17.93 s | 11.3% | 125.29 | 113.21 | 9.6% |
| Chillout | 30 | 4 | 11.61 s | 10.25 s | 11.7% | 69.61 | 64.47 | 7.4% |
| Dread | 120 | 1 | 6.38 s | 5.38 s | 15.7% | 4.33 | 3.90 | 9.9% |
| Derelict | 120 | 4 | 34.20 s | 33.25 s | 2.8% | 79.63 | 73.06 | 8.3% |
| Jaywalk | 120 | 9 | 30.30 s | 26.52 s | 12.5% | 350.26 | 321.17 | 8.3% |
| Prisoner | 120 | 1 | 12.45 s | 11.53 s | 7.4% | 22.87 | 20.12 | 12.0% |
| **Total** | | **24** | **115.16 s** | **104.87 s** | **8.9%** | **651.99** | **595.92** | **8.6%** |

Times are medians of three fresh generations per version for each film except Jaywalk, which had seven. Each run includes child worker startup. The aggregate compares the sums of the unrounded per-film medians. Sizes use decimal MB. Every repeated generation of a given film and recipe produced the same replay SHA-256.

Jaywalk had the largest timing variation. Fresh runs ranged from 28.84 to 35.43 s on the released worker and 26.26 to 35.78 s on the candidate. In three additional runs per version with client workers already running, the medians were 29.25 and 26.28 s, a 10.2% reduction.

## Encoding and processing

The writer encodes moving float32 coordinates using the viewer's existing linear prediction when the signed residual fits in 17 zigzag bits. It tries a difference from the previous value next, then writes the exact literal. A Zstandard setting tuned for short matches compresses the resulting base stream. The independent 2,048-tick chunks retain their seek points.

The pose writer quantizes directly into a contiguous run buffer. It reconstructs each rounded bone as part of enforcing the existing point-error bound. It chooses first- or second-order coding by counting bytes, then emits the shorter form once. The independent wire verifier still decodes every channel and checks every raw fallback. The encoder also skips event scans when all source counters for a player match and uses a bounded 64 KiB export buffer on the new Linux standalone recipes.

The match worker starts positively identified client parts during host map staging. Unlabeled parts wait for the verified host where required. The same bounded worker pool handles both paths and can recover a failed child on the parent. Parsing the staged match once and binding decoded network blocks to their exact physical and logical hashes removes repeat work during assembly.

Worthy illustrates the remaining size constraint. Its released file contains 63.89 MB of base state, 32.98 MB of skeletal data and 24.30 MB of recorded network observations. The entire 80%-reduced file would have to fit in 25.06 MB. On Derelict, playing just the host through the pinned simulator with its binary export sent to a sink took 11.25 s and verified all 802 recorded hashes. The 80% whole-job budget is under seven seconds.

A separate experiment transposed fields into columns on six 2,048-tick base-state blocks from Worthy, Chillout and Prisoner. All values round-tripped. Their compressed base payload fell from 3,881,677 to 2,066,023 bytes (46.8%). The JavaScript prototype took a median 975 ms to encode and 389 ms to decode one block. These measurements cover base state only. The measured worker uses the faster encoding described above. [Column encoder and decoder](tools/match-size-poc/columns.mjs)

## Fidelity and compatibility

The comparison used the Svelte viewer's match range reader and delta decoder on both files. It checked all 611 chunks independently in reverse order, every decoded world value including signed zero, the uncompressed skeletal channel bytes, and all 406 embedded diagnostic entries. Across 24 perspectives the worker verified 1,231,037 ticks and 10,270 recorded hashes. The completion comparisons cover native statistics, graphs, occupancy, settings, clock alignment, source identities and the separate diagnostic sidecar. Chrome 157 fetched HTTP ranges and decoded first, middle and last chunks for all 24 perspectives. All 72 paired seeks returned matching sampled frames and reconstructed player poses.

All seven host profiles retain their previous simulator hashes and viewer/analytics contracts. Beta 3, Arena, Beta 4 and Beta 5 move from host exporter 44 to 45. Betas 6 and 7 move from 50 to 52, and Beta 8 moves from 51 to 52. The separate Beta 5 client stays on 41. Its 5,134-frame replay is byte-identical, and all 43 clock alignment rows match. The release inventory includes all 129 exporter entries. The sibling API validated the candidate against 57 prior release manifests.

Separate Arena, Beta 4 and Beta 6 fixtures exercised the initial, viewer rebuild and full reparse callback contracts. Retained Beta 5 and Beta 7 recipes reproduced their complete archived files byte for byte. An injected remote-client failure on Worthy produced the same final SHA-256 through the parent fallback.

The encoder and pose suites passed 111 Rust tests, with one ignored. All 323 Node tests and 133 packaged Python worker tests passed. The H1-focused API suite passed 1,206 tests with four skipped. The frozen image also passed the read-only, non-root Lambda health and invalid-job checks.

Private release staging copies each distinct binary once and hard-links identical bytes inside the new Docker context. The source store and staged copies are independently checked against the registry. On a Linux filesystem the seven profiles and 129 exporters occupied 2,671,615,473 bytes of binary data across 89 distinct files, compared with 4,705,213,314 bytes across their registered paths. This measurement is separate from the replay file sizes above.

## Reproduce

The local baseline image is `halospawns-h1-film:20261125-r1` (`sha256:b4a189254d5713725438be2dfb007e7c844082f1561a2013f0780802ccd9d752`). The frozen local candidate is `h1-film-perf:verified` (`sha256:df5aca1413c97f4daff60727463787ce93eea9d51a09fc66b007829c763d7b0f`). It packages the compiled Linux encoder, worker runtime and registry over the released image. A clean Dockerfile build exhausted the shared builder's disk space while importing the private engine store. The compact staging tree passed the release audit independently. All measurements and callbacks were local.

From Linux or WSL, run the pool harness once per image and film with a fresh evidence directory. Supply the released recipe explicitly when benchmarking an older image against the checkout's newer registry. Use `--warm` to start the child containers before timing a fresh conversion. `--keep-viewer` copies the initial replay into the evidence directory after the measured interval.

```sh
python3 lambda/h1_film/tools/benchmark-world-pool.py \
  --film "$FILM" --map "$MAP" --profile "$PROFILE" --image "$BASELINE_IMAGE" \
  --revisions "$OLD_EXPORTER" "$ANALYTICS" "$VIEWER" --workers 8 \
  --initial-only --keep-viewer --output "$BEFORE"
python3 lambda/h1_film/tools/benchmark-world-pool.py \
  --film "$FILM" --map "$MAP" --profile "$PROFILE" --image "$CANDIDATE_IMAGE" \
  --workers 8 --initial-only --keep-viewer --output "$AFTER"
node --max-old-space-size=6144 lambda/h1_film/tools/compare-replay-fidelity.mjs \
  "$BEFORE/replay.hsrv" "$AFTER/replay.hsrv" ../halospawns-svelte --worker-products
```
