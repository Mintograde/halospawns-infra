locals {
  pipelines = {
    for name, pipeline in var.pipelines : name => merge(pipeline, {
      unprocessed_prefix = "${trim(pipeline.unprocessed_prefix, "/")}/"
      processed_prefix   = pipeline.processed_prefix == null ? null : "${trim(pipeline.processed_prefix, "/")}/"
      failed_prefix      = pipeline.failed_prefix == null ? null : "${trim(pipeline.failed_prefix, "/")}/"
    })
  }

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
