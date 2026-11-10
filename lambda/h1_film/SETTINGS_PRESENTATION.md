# Source-bound game settings presentation

Beta 6 and Beta 7 recorded the values correctly, but the frontend's hand-maintained
semantic table stopped at Beta 5. The generated presentation catalogue fixes
labels, enum choices, units and preset defaults for existing and new games.
It is separate from `halospawns.h1FilmSettings.v1`: recorded bytes, snapshot IDs,
generation selections and receipts stay unchanged. No reparse or migration is needed.

`export-settings-presentation.mjs` verifies the complete source fingerprint against
the registered engine, then compiles the upstream preset builders and enum label
functions using the Linux toolchain. It extracts all seven presets, menu labels,
movement defaults and source hashes. Reviewed display rules cover inverse toggles,
sentinels, units and applicability. New unclassified coded fields fail generation.
These rules describe stored configuration; they do not claim measured runtime values.

The frontend compares against the first built-in matching the recorded game mode
and team setting. Custom names cannot establish parentage; CTF 5 compares to CTF 3
and Octagon compares to FFA 50. Inactive rules, unknown codes and missing evidence
are excluded. LAN and online have different network defaults, so network-model
values are labeled but not classified as deviations. Defaults never fill gaps in
the recorded values.

## Updating an engine

Use a clean source snapshot and the registered profile ID:

```powershell
node lambda/h1_film/tools/export-settings-presentation.mjs --source .build/beta7-source/src --profile h1-performance-beta7-p9844-wasm-v1 --output .build/beta7-settings-presentation.json --build .build/settings-beta7
node lambda/h1_film/tools/sync-settings-presentation.mjs --profile .build/beta7-settings-presentation.json --api ../halospawns-api --frontend ../halospawns-svelte
```

The default Docker image is `halospawns-beta7-linux-toolchain`; `--image` can select
another image with clang-18 and the 32-bit development libraries. No simulation
stubs are used. Generated build scratch and compiler diagnostics stay under `.build`.
The sync tool preserves previous profiles and validates exact source identities.
Node tests and `check-release.mjs` require metadata for every newly registered
engine, with an explicit exemption only for the four existing legacy ports.

Commit the generated infra/API catalogue and deploy the API. Its existing
`GET /v1/games/settings/catalogue` route returns `presentation_profiles` keyed by
exact engine ID. Game details fetch it alongside the game, so subsequent engines
using the supported settings contract need no new frontend semantic table. The
frontend's generated copy is a fallback during API rollout or request failure.
New raw fields still need adapter/catalogue support; changed enum meanings or
applicability require source review before publishing their generated metadata.

## Verification (2026-11-10)

Both complete source trees match the frozen Beta 6/7 fingerprints. Defaults cover
77/78 variant fields and all seven presets. A read-only audit of the 125 selected
dev games (124 Beta 6, one Beta 7) found no remaining available numeric code without
a label. Two games have active deviations; the Beta 7 game has three configured
bots. All 505 historical settings snapshot hashes are unchanged after rollout.
API 239 is deployed through CI; all 194 Python/45 contract files match its commit.
All 137 Node, 2,162 API unit and 815 site tests, both builds and Chrome desktop/
mobile checks using real Beta 6/7 API responses pass. Frontend remains local and
uncommitted. Evidence and live checks are under `.build/settings-followup/`.
