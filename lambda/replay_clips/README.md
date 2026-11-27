# Replay clips

The site lists published highlights at `/clips` and opens each one at
`/clips/{id}`. A signed-in player can mark the first and last frames in the
replay viewer, choose the subject and save up to 60 seconds. Playback uses the
host recording and the existing map assets. Each recorded player in the
interval remains available to spectate.

The collection can be filtered by the featured player, exact map, clip source
and play type. The URL preserves the selection. Player and map choices show
counts across the whole collection with the other filters applied. A player's
recorded aliases resolve to the same profile when linked. Cards show the clip's
start on the game clock and the match date, when known, in the viewer's time zone.

## Extraction

The API pins each request to a selected viewer artifact, player slot and
half-open interval on the source clock. The worker reads the versioned object
and its index, then range-reads the overlapping host-world chunks. For legacy
standalone artifacts without a stored version, the worker pins the current
object version and verifies its recorded digest.

Each output begins with an independent keyframe. The worker re-encodes
lossless frame data, restarts quantized pose predictors at cut boundaries and
copies literal pose matrices. Snapshot clocks and in-range event times retain
their original values. The viewer transport displays elapsed clip time.
Published assets use the existing version 1 or 2 delta container and a
SHA-256 key under `replays/derived/viewer/clips/v1/`. A clip needs only its
own file and the shared map assets to play.

## Highlight selection

Automatic highlights use the default statistics pool of publicly visible PB2
2v2 games with complete recording coverage, a stable roster, zero recorded bots
and no verified idle exclusion. Discovery, extraction and publication check
that policy. An existing automatic clip drops out of the collection and its
share link becomes unavailable if its game loses eligibility. Its stored
product can be used again if the game qualifies later. Player-created clips
follow the source replay's public visibility and can be saved from other games.

The API scans statistics generations tied to the selected PB2 viewer artifact.
It rebuilds each player's kill sequences in callback order, including death
resets and the engine's four-second multikill clock. A sequence must agree with
the recorded award totals across all compatible clock phases. The highest tier
produces one clip. A double qualifies when one of its kills has verified
shot-time no-scope or double-melee evidence. Each clip records the triggering
event indices and source ticks and includes up to three seconds before the first
kill and four seconds after the last.

The worker also shortens eligible older automatic highlights. It serves the
original clip until the shorter file is ready, then publishes the new start
and file together at the existing share link. Player-selected boundaries are
stored with each manual clip.

## Operation

An EventBridge schedule discovers new generations and drains the extraction
queue every minute. Player submissions also wake the worker immediately.
The API prioritizes player jobs, leases work transactionally and accepts a
completion only for its active lease. Save retries reuse the original request
ID. Conditional S3 writes and immutable versions allow extraction retries.

Terraform owns the dev worker, schedule and permissions in the `app-api`
component. After the API migration and compatible API release, publish worker
code with `python scripts/publish-replay-clips.py`. Packaging takes the delta
codec from the sibling `halospawns-svelte` checkout. Run the extractor
regressions with `node --test lambda/replay_clips/cut.test.mjs`.
