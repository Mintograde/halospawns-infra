# H1 Pose Codec Experiment

The fine candidate's math/wire code is now shared with the production
[revision-4 implementation](../POSE_COMPRESSION.md) in `../pose_codec`.
This document records the original experiment; `.h1pc` remains experimental.

Offline proof of concept, 2026-10-10. This package does not change the deployed
converter, Terraform, replay contracts, API artifact selection or frontend loader.
It consumes existing compact replay containers and writes a separate `.h1pc`
experimental format. It does not run simulation or calculate replacement analytics.

## Results

Recommended candidate: **`local3-fine`**, retaining every 120 Hz tick. Figures
below compare complete already-compressed source artifacts with complete new
artifacts, including manifests and indexes. MB/GB are decimal.

| Sample | Original compact | Experimental | Reduction factor |
| --- | ---: | ---: | ---: |
| 32 LAN films, 9 map variants | 4,358.63 MB | 1,005.78 MB | 4.33x |
| Full first Prisoner film | 119.33 MB | 27.90 MB | 4.28x |
| Additional current revision-3 artifact | 97.75 MB | 22.89 MB | 4.27x |

The corpus reduction is **76.92%**. Individual files range from 4.22x to 4.58x
smaller. This pass reused the existing Beta 3 conversions of the supplied LAN
demos; it rehashed all 32 original films against their recorded provenance.

- Full native verification: 3,373,727 ticks and 223,266,017 bone matrices.
  All non-pose fields exact; all chunks read back in reverse seek order;
  zero raw-pose fallbacks across 11,750,843 poses.
- Maximum node-position error: `0.00004677` game units; RMS `0.00001220`.
  Maximum rotation error: `0.002719` degrees. Maximum checked point-error
  bound at radius one: `0.00008418`, below the `0.0002` limit.
- Independent JavaScript: every tick of the first Prisoner film, plus
  first/middle/last chunks from every corpus film. Rust/JS matrix component
  disagreement on the full Prisoner film was at most `3.64e-12`.
- Chromium: 13 actual compressed chunks decoded in-browser, covering 26,624
  ticks. Displayed poses matched the Node decoder exactly. Checks of 604,608
  skinned vertices over 268 sampled poses found maximum error `0.00003235`
  and no rotation-layout changes. Desktop/mobile canvas, motion and orbit
  checks passed. This is sampled visual validation, not a full-corpus render.
- Validation: 24 Rust tests, two JavaScript tests, release build and strict
  Clippy passed. Detailed measurements and per-film hashes are in [RESULTS.json](RESULTS.json).

On the full Prisoner film, `local3-balanced` reached 26.47 MB instead of
27.90 MB, but maximum positional error grew about 14x. That extra 5% saving
does not justify making it the recommended preset. The fine corpus now has
687.92 MB of non-pose payload and 316.91 MB of pose payload, so poses are no
longer the dominant remaining cost. Further major reductions would also need
to address other tick fields, or change the quality/sample-rate tradeoff.

## Approach

All source ticks, players, object identities, non-pose fields and replay metadata
are retained. Only nonempty player `model_nodes` arrays are approximated.
Comparison preserves numeric bits, array order and object membership/values;
JSON object insertion order is not significant. No frame decimation is used.

- Separate the ordinary replay delta stream from skeletal pose tracks.
- Start new tracks at chunk boundaries, missing poses, object/identity changes,
  tag changes or node-count changes. Each chunk is independently seekable.
- Express each bone relative to its parent. Root translation is relative to
  the exact player position already present in the base stream.
- Represent rotations as normalized quaternions, optionally storing only the
  three smallest components plus the omitted component index.
- Quantize translations, rotations and scale; collapse constant tracks.
- Choose first- or second-order integer temporal deltas per channel, then Zstd.
- Reconstruct every pose during encoding. Store the original entire pose as
  float64 when decomposition, range checks or the error bound fail.

The `local3-fine` candidate uses original-parent local transforms, translation
steps of `1/65536` game units, smallest-three quaternion levels of `131071`,
and scale steps of `1/65536`. The quaternion quantization interval is
`1/(sqrt(2)*131071)`. The maximum allowed point error is `0.0002` game units
at a node-local radius of one unit. It is lossy, not float-bit-identical.

The checked bound is `|delta_position| + radius * ||delta_scaled_basis||_F`.
It bounds any point inside that local sphere, including accumulated hierarchy
error, matrix decomposition error and final float32 reconstruction rounding.
Exact fallback has zero error. Measurements use game units; no assumed
world-unit-to-meter conversion is required.

Modes `world`, `root`, `hierarchy` and `local` compare coordinate/prediction
choices. `hierarchy` encodes against reconstructed parents to limit accumulated
error; `local` uses original parents for more stable/compressible tracks.
Append `3` for smallest-three rotations. Qualities are `fine`, `tight`,
`balanced` and `small`. Each candidate enforces its own error bound.

## Commands

From the infra repository root, with Rust and Node 24 available:

```powershell
cargo test --locked --manifest-path lambda/h1_film/pose_codec_poc/Cargo.toml --target-dir .build/h1-pose-codec
cargo build --release --locked --manifest-path lambda/h1_film/pose_codec_poc/Cargo.toml --target-dir .build/h1-pose-codec
node --test lambda/h1_film/pose_codec_poc/decode-pose.test.mjs

node lambda/h1_film/pose_codec_poc/extract-rig.mjs '<exported.glb>' '<new-rig.json>'
$exe = '.build/h1-pose-codec/release/h1-pose-codec-poc.exe'
& $exe pack '<source.hsrdc>' '<new.h1pc>' local3-fine '<rig.json>'
& $exe verify '<source.hsrdc>' '<new.h1pc>'
& $exe expand '<new.h1pc>' '<new.approximate.120hz.hsrdc>'
```

All outputs must be new paths. An optional final `pack` argument limits the
number of chunks for pilot comparisons. Partial reports deliberately do not
claim a full-file ratio and cannot be expanded for viewer use.

`expand` produces a larger legacy-format file for offline viewer compatibility;
it is not the small experimental artifact. Its pose matrices are approximations.
The original file is never overwritten. Keep its companion experiment/report.

```powershell
node lambda/h1_film/pose_codec_poc/run-corpus.mjs $exe '<verified-corpus>' '<new-output-directory>' '<rig.json>' local3-fine 0 8
node lambda/h1_film/pose_codec_poc/verify-js.mjs ../halospawns-svelte '<source.hsrdc>' '<new.h1pc>' '<new-js-report.json>' all
node lambda/h1_film/pose_codec_poc/verify-js-corpus.mjs ../halospawns-svelte '<native-corpus-output>' '<new-js-corpus-output>'
node lambda/h1_film/pose_codec_poc/preview.mjs ../halospawns-svelte '<exported.glb>' '<js-report.json>' 5188
node lambda/h1_film/pose_codec_poc/check-preview.mjs http://127.0.0.1:5188 '<evidence-directory>'
```

The JS verifier also accepts a final expanded legacy artifact for an independent
Rust/Three.js reconstruction comparison. `sample` selects first/middle/last
chunks; `all` visits every chunk in reverse order. The browser preview applies
the source and decoded poses through the sibling viewer's actual
`playerModelNodes.js`, checks skinned vertices and rotation-layout decisions,
and displays a short 120 Hz clip plus the largest measured pose errors.
The preview fetches the actual experimental chunks, checks their SHA-256,
decodes them in the browser with Fzstd/Three.js, and compares those poses with
the separately verified Node reference before rendering them.

The JS tests and tools resolve Three.js from the sibling viewer's installed
dependencies. Set `HALOSPAWNS_VIEWER_REPO` for another test checkout.
The screenshot tool accepts a Playwright package path, or discovers the locally
installed package through Playwright's `.links` directory.

## Experimental Wire Format

`H1POSE01` uses the existing 32-byte container header layout, with its own
magic and `halospawns.poseCodecExperiment.v1` manifest. The manifest includes
the exact source SHA-256/manifest, settings, skeleton provenance and indexed
chunks. It must not be advertised as a supported `viewer_replay_delta` artifact.

Each independently Zstd-compressed chunk holds `PC01`, four little-endian
uint32 lengths (base raw/compressed, pose raw/compressed), and two Zstd frames.
The base is the existing HSRD codec with extracted poses removed. The pose
stream has uint16 run count, then per run: uint16 first local tick, uint8
player-array slot, uint16 frame count, uint8 node count and parent-plus-one
uint8 indices. Runs do not require parents to precede their children.

There are eight integer channels per bone: translation XYZ, scale, then either
quaternion XYZW or three components and the omitted index. Each track has a
mode byte, initial int32, and signed ZigZag-varint deltas for nonconstant modes.
Modes are 0 constant, 1 first differences, 2 second differences. A uint16 raw
fallback count follows the tracks; each fallback stores a uint16 frame index
and 13 float64 values per node. Raw fallbacks replace complete poses.

## Limits And Next Work

- This is a compression/quality experiment, not a production format commitment.
  It deliberately does extra encode/decode validation and is not a measurement
  of Lambda conversion speed. Corpus jobs run concurrently on the Windows host.
- The native reader/writer reuses the existing lossless replay codec. The JS
  pose decoder is an independent implementation using Three.js mathematics.
- Current real-film measurements cover the four-player Beta 3 corpus and its
  19-node player models. Hierarchy mode requires a matching supplied tag and
  node count; it does not guess a skeleton for an unknown model.
- Rig metadata is extracted from an actual GLB and records its SHA-256. It is
  embedded in the experimental manifest. Skeleton topology can be used as a
  coding basis without changing the target matrices. Production asset identity
  must nevertheless be explicitly bound to the selected map/model release.
- Error bounds cover node-local points within the stated radius. The GLB
  extractor measures all weighted vertex influences and attachment markers
  against that radius. Browser geometry checks sample actual rendered poses;
  they are not an exhaustive browser run over every film.
- Production work needs a versioned codec/artifact contract, opt-in converter
  emission, browser range loading and bounded decode workers, API negotiation,
  retained old-format support and coordinated rollout. Analytics, simulation
  hashes and original films should retain their existing exact contracts.
- Before promotion, extend malformed-input/resource-budget tests and assess
  camera/aim/attachment consumers at the chosen tolerance. The existing
  frontend's cached decoded-tick memory layout is unchanged by this POC.

Private artifacts, logs, source provenance and detailed reports are under
`L:/tmp/halospawns-h1-pose-codec-20261010`. See `RESULTS.json` for the compact
measurement summary; no films, maps or generated replays are committed here.

The local summary can be reproduced to a new destination with
`node lambda/h1_film/pose_codec_poc/summarize.mjs L:/tmp/halospawns-h1-pose-codec-20261010 <new-results.json>`.
It requires all 32 native results and independent JS samples, and rehashes the
original films against their conversion provenance.
