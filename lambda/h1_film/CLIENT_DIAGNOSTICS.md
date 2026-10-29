# Beta 5 client diagnostics

Beta 5 exporter **11 / analytics 4 / viewer 5** exports the recorded evidence
needed for the theater's client diagnostics. The simulator, authoritative world
replay, poses and combat totals are unchanged. Exporter 10 and all earlier
recipes remain available. Exporter 11 uses the same pinned Beta 5 WASM/glue;
the new behavior is the converter's extraction of the recorded sections.

The data has a separate versioned format, `halospawns.h1ClientDiagnostics.v1`.
It is a companion to the world replay, not a new pose encoding. A companion
keeps the different clocks and coverage explicit, permits bounded range reads,
and allows existing viewer-5 clients to continue playing the world unchanged.
No viewer-6 migration is required. Future overlay UI consumes the companion.

## Products and delivery

Local conversions with `--exporter-revision 11` write
`candidate/client-diagnostics.h1diag` and `report.client_diagnostics`.
The cloud worker uploads it beside the viewer in the same immutable generation:
`h1-client-diagnostics.v1.<sha256>.h1diag`. The completion's typed
`viewer_artifact.h1_diagnostics` binds the source film, raw map, engine profile,
source tick count, content hash, manifest hash, bucket, key and S3 version.
Both initial/full and viewer-only conversions include it. Receipt retries
reuse the original descriptor and validate all bindings; old receipts stay valid.

The API persists the validated descriptor in viewer artifact metadata. It
requires the companion for Beta 5 exporter 11+, rejects it on older recipes,
and rejects cross-source, map or generation substitutions. No DB migration is
needed. `GET /v1/replays/<id>/asset` returns `asset.h1_diagnostics` with its own
version-pinned delivery URL and expiry using the configured S3/CloudFront mode.
Public descriptors omit storage identifiers. The selected viewer generation
also selects the companion. Never combine a current companion with an old viewer.

## Binary contract

All integers and floats in binary records are little endian. Header (32 bytes):

| Offset | Type | Value |
| --- | --- | --- |
| 0 | 8 bytes | `H1DG0001` |
| 8 | uint32 | version 1 |
| 12 | uint32 | header size 32 |
| 16 | uint32 | UTF-8 JSON manifest byte count |
| 20 | uint32 | total artifact byte count |
| 24, 28 | uint32 | reserved, zero |

The manifest follows immediately, followed by the exact original LDG1 and/or
LDC1 section bytes in manifest order. All offsets in section/table/chunk
descriptors are relative to that body's start. There is no outer compression.
Artifact maximum is 128 MiB; manifest maximum is 2 MiB. No section is silently
omitted for size, unknown version or malformed bounds: extraction fails closed.
This contract accepts LDG1 v5 and LDC1 v11 from the pinned Beta 5 source only.

The manifest has `schema`, `source` (film/map SHA-256, engine profile, source
tick count/rate), `match_id` (16 lowercase hexadecimal digits, high word first),
`recording_kind` (`host` or `client-enriched-host`) and `sections`. Empty
`sections` means no recorded diagnostic evidence, not a perfect connection.
Each section preserves its version, flags, clock period, host rules, byte
count/hash and table directory. Client sections also expose own machine/player
slots and the last host verdict tick (`-1` means the host sent none).

Each table has its original row count/stride, offset, capped flag and chunks of
at most 2,048 original rows. Each chunk has first row, row count, offset, byte
count/hash and min/max ranges for the clocks actually recorded by those rows.
Negative unknown clocks are excluded from the index, but their rows remain
readable by row index. Net/input ranges include their full interval. Poses have
no clock: fetch them by a shot's original pose index. Rows are never reordered
or filtered, so all original references remain valid. Raw section bytes include
reserved fields and all packed pose components, even when a decoder cannot
display a value. Nonfinite geometry decodes as null and must not be rendered.

## Recorded evidence

| Section / table | Stride | Use |
| --- | ---: | --- |
| client / shots | 88 | Report identity, origin/direction, impact/target, head claim, damage tag, pose and round links |
| client / clock | 8 | Recorded client/host clock samples |
| client / poses | 264 | Client-seen target's quantized nodes, head node, model tag, scale and quality flags |
| client / hits | 44 | Received shield/body damage, vitalities, victim/attacker, death/corpse evidence |
| client / host_verdicts | 88 | Host refusal/result, claimed/tested/handled times, checked geometry and probe count |
| client / aim | 28 | Local eye, yaw/pitch/FOV, view host tick, alive/seat |
| client / seen | 28 | Remote players as drawn by the client: center/yaw, capsule, unit and visibility flags |
| client / net | 44 | RTT/ping/jitter/loss, message counts, clock/slew/catch-up intervals |
| client / corrections | 44 | Predicted versus host positions, move kind and stamp |
| client / pulls | 48 | Fired/thrown rounds, weapon/projectile tags, origin/direction, seat/pellet/report count |
| client / screen | 20 | Client kill feed and death notices, all three clocks, subject/other/seat |
| client / inputs | 16 | Host-observed repeat/merged/lost/silent/stale input intervals |
| client / blasts | 28 | Where a client round ended, end kind, point and pull link |
| ledger / damage | 28 | Host damage record with flags, attribution and shield/body amounts |
| ledger / deaths | 88 | Host death decision and four attribution history entries |
| ledger / verdicts | 88 | Host verdicts, same layout as client copies |
| ledger / clock | 12 | Per-machine client/host clock samples |
| ledger / inputs | 16 | Host input-arrival evidence for recorded machines |

Source layouts and semantics are pinned to h1-arena
`fbbfae27d6be7e47613acce37da95ed754dccb42`, especially
`src/host/blampc_film_{client,ledger,shotmarks}.{c,h}` and
`src/tools/film-ledger.py`. `runtime/diagnostics-codec.mjs` is the reference
browser-safe field decoder, range reader, pose unpacker and identity linker.
Its identical frontend copy is `packages/viewer/src/lib/core/session/h1ClientDiagnostics.mjs`.

## Frontend interpretation

- Validate descriptor/source bindings, manifest hash and each fetched chunk
  hash. `openDiagnostics(readRange, descriptor, expectedSource)` performs these
  checks. `readRange(start, length)` must return exactly that bounded byte range
  and propagate the session abort signal; reject oversized/full-file fallback.
  Callers own a bounded cache. No full replay-tick scan is needed.
  `openDiagnosticsUrl(descriptor, {expectedSource, signal})` supplies the bounded
  HTTP implementation: exact 206/Content-Range, streamed byte limit, hash checks
  and cancellation. `chunks(...)` returns descriptors with the index to pass to
  `readChunk(...)`. The reader performs no eager table reads.
- Preserve client, view-host, claimed-host, tested-host and handled-host ticks
  independently. Source rate is 120 Hz. Use recorded view-host times for client
  presentation and the replay's game-time index for authoritative world lookup.
  Do not assume client tick equals film tick, interpolate through clock jumps,
  clamp out-of-recording references, or treat `-1` as zero. Net intervals can
  contain clock steps. Hit messages' host tick is one after their host damage
  record; screen message times and receipt/presentation times are distinct.
- Player/owner/machine/seat fields are physical source identities, not stable
  participant IDs. Resolve them using roster epochs and unit handles at the
  applicable clock. `255` is no player, `-1` no signed handle, `65535` no blast
  object. Raw tag handles remain unsigned 32-bit values. Geometry uses original
  Halo world coordinates; apply the normal map transform once.
- `pairShotVerdicts` uses reliable `(machine,epoch,sequence,sent-client-tick)`
  or plain `(machine,sent-client-tick,report-index)` identity. Duplicate keys
  remain ambiguous. Never substitute the nearest verdict in time. The classifier
  keeps a missing local machine identity distinct from a report never sent.
  Its verdict labels distinguish head/body/head-as-body/refused/not-tested/no-verdict; unknown
  refusal-code versions remain unknown. `tested_host_tick < 0` is not tested.
- Host-check geometry is the recorded host verdict's impact/direction/target,
  optional center (shot flag 1), probe steps and tested tick. Reconstruct a host
  ghost from the authoritative replay at that tick when available; do not label
  a client pose as the host pose. `steps == 0` means no recorded biped geometry.
- `linkedPull` follows the recorder's low-16-bit row link at/before the event's
  client tick. Resolve against a complete compact pull index or a window that
  includes the linked row; absence stays unknown. `report_count == 0` is a round
  without a hit report, not automatically a confirmed miss. Predicted blast
  endpoints are recorded; an exact host-blast pairing is not recorded. Upstream's
  replay-time distance/window heuristic is not exported as authoritative truth.
- Aim/seen coverage is local seat zero; shots/pulls/screen include their recorded
  local seats. Missing tables, empty rows, capped flags, truncated/clamped poses,
  and partial verdict coverage must remain visible to the UI. Pose flags are
  truncated=1, clamped=2, differing node scales=4. Net unknowns remain sentinels:
  ping `-1`, jitter `65535`, outgoing loss `255`.
- These are diagnostic observations, not authoritative aggregate accuracy or
  combat totals. Without the host ledger, a taken verdict alone cannot prove
  exact dealt damage. Do not label all client feedback as confirmed damage.

The supplied host-world copies already include all 13 LDC tables. Separate
`_client.h1film` predicted-world playback (film flag 64) remains a different
simulation feature and is not admitted by the authoritative engine profile.
Future overlay controls and scene rendering are frontend work; this change
provides their recorded data and reader, without deploying frontend changes.

## Validation

All three supplied partial Dread films retain every diagnostic section byte.
Companions measure 105,415 / 2,748,426 / 1,647,398 bytes for 15-56-19 /
15-47-30 / 15-56-54, respectively. An independent comparison against the pinned
upstream `film-ledger.py` passes 1,018,808 field comparisons plus every decoded
pose, aim direction, round link and host verdict geometry. All 623 shot reports
pair exactly. Real evidence covers all 13 table directories; corrections are
empty and three input-arrival rows occur in the long film. Host-only LDG1
coverage, capped tables, malformed records and ambiguous/missing verdicts have
synthetic tests. Native simulation is unchanged from exporter 10's verified pins.
