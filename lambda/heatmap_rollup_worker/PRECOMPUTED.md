# Browser-ready heatmaps

Dev is deployed as worker **16**, API **288** (`8f2d924`, CI `43972096748`), infra
`470b5b5`. All 298 active scopes / 57,216 selections are populated, with unchanged
scope and historical source fingerprints. Automatic builds read the exact frozen
JSON source to keep publication byte-identical to derived-only backfills.
The final worker ZIP and 40 packaged tests pass; repeat publication of an existing
192-selection source preserves its S3 index version. API/site/Terraform tests,
both builds, live CDN and browser checks, health and nine empty queues pass.
All six postplans have no resource actions; final API/worker plans are no-op.
Frontend remains local/uncommitted. No replay reparse or production action.

The dev rollup worker also publishes immutable heatmap products under
`heatmaps/precomputed/v1/<source-sha256>/views/<decoded-sha256>.json`.
`HEATMAP_PRECOMPUTED_ENABLED` is enabled only in dev. The API repository owns the
shared, dependency-free renderer and encoding modules; the publication script
includes both files verbatim from the sibling API checkout. Publish from the
same reviewed API source used for the reader release. Verify the deployed ZIP
against all four source files before running a backfill.

Normal builds prepare all supported selections before completing their source
generation. Publication uploads compressed views first and the private index
last. Conditional S3 writes prevent replacement. Failures retry through the
existing rollup workflow; stale source generations remain inactive. No H1 exporter,
spatial source, statistics, or replay format changes are involved.

A derived-only backfill can invoke the worker with:

```json
{"operation":"precompute","key":"replays/derived/heatmap-rollups/scopes/<scope>/generation-<n>.json.gz","sha256":"<existing compressed artifact SHA-256>"}
```

Use the exact active artifact inventory and an explicitly verified worker version.
Invoke sequentially under the existing concurrency limit; retain a resumable result
for each source hash. This operation checks the configured bucket/prefix, size,
hash and schema and does not claim scopes, write SQL, select generations or reparse
replays. Compare source inventories before and after.

CloudFront may read only `heatmaps/precomputed/v1/*/views/*.json`. Indexes and raw
rollups remain outside origin access. The dedicated immutable behavior preserves
the stored gzip encoding and uses existing CORS and signing settings. The API has
only GetObject access to the small indexes; only the worker writes new products.
There is no expiration rule for this prefix. Retain objects and versions on rollback.

The API's original inline contract remains the default. An older worker produces
raw rollups without delivery products, which the new API handles through fallback.
The local frontend also falls back to the original API when an older reader rejects
the optional delivery parameter. See API `docs/precomputed-heatmaps.md` for contracts.
