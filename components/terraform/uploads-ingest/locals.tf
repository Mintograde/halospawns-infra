locals {
  pipelines = {
    for name, pipeline in var.pipelines : name => merge(pipeline, {
      unprocessed_prefix = "${trim(pipeline.unprocessed_prefix, "/")}/"
      processed_prefix   = pipeline.processed_prefix == null ? null : "${trim(pipeline.processed_prefix, "/")}/"
      failed_prefix      = pipeline.failed_prefix == null ? null : "${trim(pipeline.failed_prefix, "/")}/"
    })
  }

  replay_spatial_artifact_prefix = "${trim(var.storage.replay_spatial_artifacts.prefix, "/")}/"
  heatmap_rollup_artifact_prefix = "${trim(var.storage.heatmap_rollup_artifacts.prefix, "/")}/"

  full_domain_name = coalesce(var.cdn.domain_name, "api-${var.environment}.halospawns.com")

  upload_signing_private_key_secret_name = coalesce(
    var.cdn.private_key_secret_name,
    "/${var.project}/${var.environment}/cloudfront/upload-signing/private-key",
  )
  upload_signing_public_key_parameter_name = coalesce(
    var.cdn.public_key_parameter_name,
    "/${var.project}/${var.environment}/cloudfront/upload-signing/public-key",
  )
}
