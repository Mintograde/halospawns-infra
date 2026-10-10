# Bounded H1 Pose Compression

Revision 4 is the new H1 viewer target. Xbox retains revision 2; revisions 1-3,
old jobs, persisted retries and both retained exporters remain supported.
Analytics revision 3, film/map integrity pins and simulation are unchanged.
Deployment and backfill status belong in [DEPLOYMENT.md](DEPLOYMENT.md).

## Contract

- Container `HSRDC002`, version 2, format `halospawns.viewerReplayDelta.v2`.
- Viewer schema `halospawns.viewerReplay.v1`, profile `frontend-default`, revision 4.
- Same 2,048-tick independent chunks, range loading and 120 Hz source clock.
- Each PC01 block contains separately zstd-compressed lossless HSRD base data and
  pose tracks. Its four little-endian u32 lengths bind compressed/raw sizes.
- Known 19-node cyborg poses use parent-relative translation, scale and
  smallest-three quaternions; channels choose constant, first-difference or
  second-difference signed-varint tracks. Quantization steps are 1/65,536 for
  translation/scale and 131,071 quaternion levels.
- Reconstructed nodes are rounded to float32. Each source pose is checked
  against reconstruction with `position_error + radius * Frobenius(matrix_error)`
  at radius 1, bounded by 0.0002 game units. This is bounded lossy compression,
  not a claim that reconstructed floats are identical to the original.
- Non-rigid/unrepresentable poses use exact float64 fallbacks. Unknown model
  tags or node counts stay entirely in the original lossless base. Identity,
  model, missing-pose and lifecycle transitions split prediction runs.
- Everything except supported nonempty `model_nodes` is encoded losslessly.
  No inferred animations, pose sampling reduction or simulation changes.
- Each chunk has `compressedSha256` and `rawSha256`. The latter covers raw PC01
  bytes, not reconstructed JSON: Rust/JavaScript math can differ by tiny amounts.
  Old `tickSha256` semantics remain exclusive to revisions 1-3.

Pinned projection, manifest and encoding definitions are copied verbatim to the
API and frontend. `tools/generate-pose-contract.mjs` generates the append-only
revision; it does not change the globally selected Xbox contract.

## Runtime And Verification

`pose_codec` owns the shared Rust math/wire format. The production encoder streams
one projected tick through pose quantization and the existing incremental base
codec. Only compact integer tracks and exceptional raw fallbacks accumulate for
one chunk, not full JSON ticks. Source-to-reconstruction bounds, base values,
serialized tracks/run headers/raw fallbacks and compression round trips are
verified inline. Reports identify this as `inline-bounded-poses`.

`h1-film-encoder validate <artifact>` independently reads the completed container.
The Python readback validator requires this actual decoder for revision 4; it
does not accept framing alone as verification. The frontend validates hashes,
finite output, acyclic parents, track/run counts and content-sized zstd frames
before allocation, with cancellation/yields and bounded resident rehydration.

Focused regressions cover golden bytes, streamed/batch equivalence, missing and
empty poses, identity changes, exact fallbacks, unknown models, malformed frames,
truncation, checksums, hostile lengths and legacy profiles. The API migration
only widens its format/version pair constraint, without changing immutable rows.

## Evidence

The [original experiment](pose_codec_poc/README.md) verifies 32 films on nine map
variants: 3,373,727 ticks, 223,266,017 matrices, 76.92% smaller complete artifacts.
Production uses that same fine pose wire format inside the normal range container.

Production offline Prisoner: 70,582 ticks / 589 recorded hashes; 97,749,779 bytes
become 22,864,581 bytes (4.28x smaller). Independent frontend decoding compares
every non-pose value exactly and all 5,156,372 nodes within the bound (maximum
0.00008230). Desktop/mobile cold seeks, first-person playback and glass pass.

The streaming revision is byte-identical to the initial batch implementation but
reduces the constrained Linux full-worker harness from 96.877 to 26.815 seconds
and observed converter process-tree RSS from 2,413,020 to 300,024 KiB. The largest
supplied film (Dammy, 187,529 ticks / 1,563 hashes) passes in 62.558 seconds with
306,060 KiB observed converter RSS and a 44,111,811-byte artifact. These are local
two-CPU / 3,008 MiB runs, not Lambda timing or statistical performance guarantees.

Both films verify initial, viewer-rebuild, full-reparse and persisted completion
retry paths. Evidence: `L:/tmp/halospawns-h1-pose-default-20261010/`.

## Rollout And Recovery

Deploy readers, the compatible worker and the API-owned SQL migration before
changing API selection. Then reconvert one frozen dev canary, validate its hosted
artifact, and dispatch the remaining frozen inventory through audited normal
reprocess attempts. Preserve source versions, generation tokens, request sequence
and selection-epoch fences; never update selected artifacts directly.

Older selected generations stay usable until successful completion. Do not roll
back to a worker or reader lacking revision 4 while those jobs/artifacts exist.
Pausing future revision-4 selection alone does not make an old worker rollback
safe. No production or Xbox-format rollout is authorized by this work.
