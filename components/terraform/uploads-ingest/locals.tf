locals {
  pipelines = {
    for name, pipeline in var.pipelines : name => merge(pipeline, {
      unprocessed_prefix = "${trim(pipeline.unprocessed_prefix, "/")}/"
      processed_prefix   = pipeline.processed_prefix == null ? null : "${trim(pipeline.processed_prefix, "/")}/"
      failed_prefix      = pipeline.failed_prefix == null ? null : "${trim(pipeline.failed_prefix, "/")}/"
    })
  }

  replay_spatial_artifact_prefix     = "${trim(var.storage.replay_spatial_artifacts.prefix, "/")}/"
  heatmap_rollup_artifact_prefix     = "${trim(var.storage.heatmap_rollup_artifacts.prefix, "/")}/"
  region_stat_rollup_artifact_prefix = "${trim(var.storage.region_stat_rollup_artifacts.prefix, "/")}/"

  full_domain_name = coalesce(var.cdn.domain_name, "api-${var.environment}.halospawns.com")

  remote_cdn_hosted_zone_id = try(
    data.terraform_remote_state.environment_dns[0].outputs.zones[var.cdn.hosted_zone_key].zone_id,
    null,
  )
  cdn_hosted_zone_id = (
    var.cdn.hosted_zone_id != null ? var.cdn.hosted_zone_id :
    local.remote_cdn_hosted_zone_id
  )
  create_managed_cdn_certificate = var.cdn.enabled && var.cdn.create_certificate
  create_cdn_dns_records         = var.cdn.enabled && var.cdn.create_dns_records
  validate_managed_cdn_certificate = (
    local.create_managed_cdn_certificate &&
    var.cdn.create_dns_records
  )
  cdn_certificate_arn = !var.cdn.enabled ? null : (
    var.cdn.create_certificate ? (
      local.validate_managed_cdn_certificate ?
      aws_acm_certificate_validation.cdn[0].certificate_arn :
      aws_acm_certificate.cert[0].arn
    ) :
    var.cdn.certificate_arn
  )

  upload_signing_private_key_parameter_name = coalesce(
    var.cdn.private_key_parameter_name,
    "/${var.project}/${var.environment}/cloudfront/upload-signing/private-key",
  )
  upload_signing_private_key_parameter_arn = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.upload_signing_private_key_parameter_name}"
  upload_signing_public_key_parameter_name = coalesce(
    var.cdn.public_key_parameter_name,
    "/${var.project}/${var.environment}/cloudfront/upload-signing/public-key",
  )
}
