# Replay clips

The site lists published highlights at `/clips` and opens each one at
`/clips/{id}`. A signed-in player can mark the first and last frames in the
replay viewer, choose the subject and save up to 60 seconds. Clips open in the
featured player's recorded client view when it covers the play. Otherwise they
use the host recording. Both share the replay's existing map assets.

The collection can be filtered by the featured player, exact map, clip source
and play type. The URL preserves the selection. Player and map choices show
counts across the whole collection with the other filters applied. A player's
recorded aliases resolve to the same profile when linked. Cards show the clip's
start on the game clock and the match date, when known, in the viewer's time zone.

## Extraction

The API pins each request to a selected viewer artifact, player slot and
half-open interval on the source clock. The worker reads the versioned object
and its index, then range-reads the overlapping chunks of the selected world. For legacy
standalone artifacts without a stored version, the worker pins the current
object version and verifies its recorded digest.

For embedded views and separately attached Beta 5 recordings, match the
client's recorder in its own roster to the featured player on the host. Map
the marked host interval through the recorded clock samples, including the last
included frame. Cut the contiguous native client frames and start playback on
the recorder's local slot. Missing or ambiguous identity or clock coverage
uses the host. A full-replay link always uses the original host slot and time.
Marks made while watching an aligned client also use host coordinates.

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

The worker refreshes older clips when a client view becomes available or an
automatic highlight needs its shorter lead-in. It publishes the replacement
at the existing share link after verification. Player-selected boundaries are
stored with each manual clip.

## Card thumbnails

Once a clip is published, the screenshot renderer opens its version-pinned
compact file and the map GLB in the replay viewer. The camera follows the
featured player's slot in that recording. It captures the weapon reticle and
omits the HUD and world labels. Automatic highlights use a frame about half
a second before the first kill. Player saves use one second in, or the midpoint
of a shorter clip. If the player is dead or absent there, the renderer looks
for a live frame in the same clip.

The API exposes the resulting 768 × 432 WebP through `thumbnail_url`. The clips
worker leases screenshots independently of extraction and retries failures
while the clip remains playable. It regenerates a thumbnail when the clip or
its selected map changes. The screenshot worker reads only compact clip versions
and processed map models.

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
