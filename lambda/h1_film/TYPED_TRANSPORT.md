# H1 Typed Transport

Dev worker `typed-poses-20261014-r2` is deployed with all four exporters,
incremental world-object state and typed poses. New intake and admin attempts
select exporter 4 after API `live=182` promotion, enabling the full typed path.
Retained exporter-3 jobs remain generic and benefit only from shared codec
improvements. See [deployment](DEPLOYMENT.md).
Do not change an existing job or retry's exporter selection. No hosted conversion
or bulk reparse was submitted; the performance results remain offline evidence.

## What Changes

The simulator still runs every source tick with the same engine physics and
recorded world-hash checks. Exporter 4 replaces repeated field names and scalar
tags in three high-volume records with fixed binary layouts. It does not remove
fields, decimate ticks, lower pose quality, change analytics, or introduce a new
public viewer format.

`HSFT0002` is the private physical transport; the normalized logical export
contract remains `HSFT0001`. The registry selects the transport explicitly for
the immutable exporter. The encoder rejects mismatched headers and unknown
contracts. Omitted transport selections retain `HSFT0001`, including original
exporters 1, 2 and 3. Their original WASM/glue binaries remain in the image.
For a captured packed stream, use
`h1-film-encoder inspect-ticks capture.hsft new-output.ndjson HSFT0002`;
the inspection CLI also retains the legacy default rather than guessing.

The Rust consumer reconstructs records directly into reusable storage. A
shape-checked projection plan avoids repeated source-field lookups. Eligible
world-object arrays transfer ownership into the viewer projection and return
older storage to the next transport read, instead of copying every scalar and
tag string. This consuming path is used only after source analytics and any
30 Hz sample have been captured. Other callers retain source-preserving behavior.
Unknown or reordered shapes fall back to the general projection. Delta encoding
also reuses its already-computed changed-child decisions instead of repeating
recursive equality checks.

Full source safety, closed-schema validation, every-tick lossless delta checks,
bounded pose verification, compression round trips, source/map hashes, sandbox
settings and persisted completion checks remain enabled.

## Wire Layout

All integers and floats use little-endian storage. A stream starts with the
eight ASCII bytes `HSFT0002`. Each tick has a four-byte unsigned payload length
and one root object. Original tags 0 through 9 retain their original meanings.
Additional tags replace a complete value, not a container or object key.

| Tag | Payload, in order | Expanded value |
| --- | --- | --- |
| 10 | `u32 object_id`, `i32 object_type`, length-prefixed UTF-8 `tag_name`, nine `f32` position/forward/up components, two `u32` references | World object with the original 14 keys and key order |
| 11 | `i32 spawn_index`, four `f32` position/facing components, `i32 team`, four `i32` gametypes | Spawn object with the original seven keys and nested gametype array |
| 12 | Thirteen `f32`: position XYZ, scale, then nine basis components | Original 13-element matrix array |

World-object keys are `object_id`, `object_type`, `tag_name`, `x`, `y`, `z`,
`forward_x`, `forward_y`, `forward_z`, `up_x`, `up_y`, `up_z`, `parent_ref`,
`owner_object_ref`. A reference of `0xffffffff` expands to signed integer -1;
all other reference values expand to unsigned integers. Float bits, including
negative zero, are preserved. Non-finite numbers and invalid UTF-8 are rejected
by the encoder.

Both physical and expanded frames are limited to 4 MiB. Expansion adds exactly
170 bytes per world object, 80 per spawn and 17 per matrix. Expanded nesting
retains the original limit, including the gametype array inside a spawn. Strings
and generic collections retain their 65,536-byte/item bounds. Recycled object
shape changes restore the expansion counter before reparsing, so speculative
reads cannot count the same packed record twice.

## Independent Parity Gate

`tools/canonical-transport.mjs` is an independent Node implementation of the
inverse wire mapping, used only by offline verification. It reconstructs the
complete original `HSFT0001` stream, including keys, original scalar tags,
unprojected fields and per-tick frame lengths, without using the Rust decoder or
viewer projection. Both the physical and reconstructed streams are hashed.

`compare-performance.mjs` accepts different physical exporter bytes only when:

- Both proofs match the worker's film, raw map, WASM/glue hashes, exporter
  revision, transport contract, simulation results and physical byte counts.
- The complete canonical stream hashes and byte counts are identical.
- Every artifact and all non-operational callback values match, except the
  explicitly verified exporter provenance fields.

This is stronger than comparing projected replays alone: a dropped field that
the viewer currently ignores still fails full-source parity. The canonical
reconstruction adds diagnostic CPU work; its engine-proof wall time is not a
performance comparison against an older raw stream hash. Worker timings exclude
this independent proof pass.

## Scope And Next Work

Measurements and reproduction commands are in [PERFORMANCE.md](PERFORMANCE.md).
The offline harness mocks S3 and the API; it does not measure Lambda cold starts,
network time, queue delay or hosted CPU allocation. Supplied films are not a
maximum-limit stress test or proof of parity for every game mode.

The first **incremental-state** implementation now retains immutable world-object
records across the Rust pipeline. It is included in the deployed typed-pose image
and enabled for new exporter-4 conversions. It changes no engine,
exporter identity, wire bytes, public
schema or pose settings. The physical exporter still emits every complete tick.

### Retained World Objects

- The reader compares each object's complete wire record with the previous
  record at that array position. Only exact equality permits reuse; object IDs,
  hashes and inferred motion are not sufficient. Reordering, removal, respawn,
  shape changes, signed zero and unprojected fields participate in invalidation.
- Unchanged records share immutable `Arc` ownership. Their validated object type
  is available directly to observations; their generic source value is built
  only when the record changes. Raw bytes and expanded-frame costs remain
  bounded and are charged on cache hits as well as misses.
- Projection and closed-schema validation are cached with the exact immutable
  source record. Changed records still run the normal source-safety, projection
  and item-schema checks; array limits are checked every tick. The rest of the
  tick retains the existing safety and closed-schema path.
- Delta encoding carries two ticks of retained object history and skips recursive
  equality checks for shared records. It uses the existing numeric codec and
  preserves the original sparse/dense choices and string-table order.
- Every tick still passes through the independent delta decoder. A cached exact
  comparison is valid only when **both** the immutable source record and decoded
  object retain their previously verified identities. Otherwise every field is
  compared again. Chunk boundaries reset prediction and decoded history.

The Linux `HSFT0002` / viewer-4 path enables this by default. `--generic-state`
selects the original decoder/projection path for ablation and rollback testing.
Older transports, other viewer revisions and the Windows encoding-worker path
retain the generic implementation. A requested 30 Hz secondary artifact
materializes complete objects only on its sampled ticks, without changing the
120 Hz conversion or analytics.

`--verify-incremental-state` is an offline diagnostic: independently decode the
same full frame with the generic decoder and compare its complete serialized
source against the retained-state reconstruction **before** normalization and
projection. This includes unknown fields, key order and negative zero. It fails
unless incremental mode is active and adds deliberate CPU work, so its timings
must not be used as performance measurements. The benchmark wrapper exposes
`-GenericState` and `-VerifyIncrementalState`; paired corpus runs expose
`-BaselineGenericState` and `-CandidateGenericState`.

The internal `encoding.json.state_reuse` report records enabled mode, decoded and
reused object counts, and the number of full-source diagnostic comparisons.
These counters do not change public callbacks. Regression tests compare complete
chunk bytes/hashes and independent pose packing through lifecycle changes,
keyframes, optional fields and corrupt decoder state.

### Typed Player Poses

The next slice decodes canonical packed model matrices directly into four
reusable typed pose buffers, rather than expanding each matrix into 13 JSON
numbers and immediately reading them back into a numeric vector. Player metadata
and noncanonical poses still use the generic representation. No ticks are skipped.

- Only complete packed matrix arrays for a known skeleton/count use the typed
  path. Missing, null, empty, mixed, wide and unknown-model arrays preserve the
  original projection/fallback semantics. Tags may follow nodes in wire order;
  player reordering and key changes cannot retain stale pose slots.
- A compiled projection/schema proof permits empty JSON placeholders only when
  the real typed nodes undergo equivalent array and numeric-range validation.
  Unsupported layouts fall back to the original path. Source-depth, non-finite,
  duplicate-key, raw-frame and expanded-frame gates remain enforced.
- The codec borrows typed nodes directly. Raw fallbacks copy the exact matrices;
  quantized poses retain the existing independent reconstruction/error-bound
  checks and lossless track verification. Pose quality and PC01 bytes do not change.
- Run identities retain three scalar values instead of allocating a temporary
  JSON array every pose. At most four quantizer workspaces retain validated
  topology and scratch buffers. Each source transform is calculated once per
  pose and reused by its children; no transform is reused across source ticks.
  Closed runs do not retain scratch buffers. The independent reconstruction path
  still computes and validates its own hierarchy.
- Full-source diagnostics restore both objects and poses before comparing against
  a fresh generic decode. Secondary 30 Hz output materializes nodes only on sampled
  ticks; analytics and 120 Hz verification remain complete.

`--generic-poses` / benchmark `-GenericPoses` disables only direct typed pose
transport, leaving world-object reuse and the codec workspace improvements on.
Paired corpus runs expose `-BaselineGenericPoses` and `-CandidateGenericPoses`.
`--generic-state` disables both incremental transport slices. Older transports
and Windows retain generic input decoding; the shared pose codec benefits from
bounded workspaces without changing retained contracts.

Internal counters `typed_poses`, `poses_decoded` and `pose_nodes_decoded` identify
the active path. Full-source verification remains separately opt-in and its
timings must not be included in speed measurements. See [performance evidence](PERFORMANCE.md).

### Remaining Work

This is retained world-object and typed pose state, **not** a complete typed-state
rewrite. Changed objects still materialize generic values, and player metadata,
spawns and other metadata retain their existing paths. Further candidates are
typed player metadata, exact reuse of unchanged map state, and producer-side
changed-field records. Producer changes would require a new retained exporter
and independent reconstruction of every original source tick; they are not
implied by this consumer-only optimization.

The gain depends on the unchanged-record ratio. High-churn scenes and maximum
source limits still need profiling; the supplied corpus does not establish a
universal speedup or worst-case memory bound for those workloads.

Parallel chunk encoding also needs bounded queues and ordered assembly, and
must demonstrate a benefit within the actual CPU budget rather than simply
increasing contention with the simulator. Consecutive simulation ticks are
state-dependent; arbitrary time ranges are not independent parallel tasks.

Do not disable simulation hashes, skip public-schema checks, relax physics,
change pose quality, or advertise native execution as a demonstrated large win
to reach a runtime target. A hosted timing canary remains separate work; the
user-authorized dev rollout completed compatibility-first.
