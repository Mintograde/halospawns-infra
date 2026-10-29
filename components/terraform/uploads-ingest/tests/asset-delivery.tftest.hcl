mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "283279960672" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:283279960672:test-topic" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:283279960672:certificate/00000000-0000-0000-0000-000000000000" }
  }
}

variables {
  environment = "dev"
  storage = {
    allowed_cors_origins = ["https://dev.halospawns.com", "http://127.0.0.1:5173"]
  }
}

run "seed_public_key" {
  command   = apply
  state_key = "assets"
  module {
    source = "./tests/fixtures/signing-key"
  }
}

run "s3_default" {
  state_key = "assets"
  command   = plan
  assert {
    condition     = var.asset_delivery_mode == "s3" && length(local.asset_trusted_key_groups) == 1
    error_message = "S3 rollback must leave CDN signatures enforced."
  }
  assert {
    condition = alltrue([for policy in aws_cloudfront_cache_policy.assets :
    toset(policy.parameters_in_cache_key_and_forwarded_to_origin[0].query_strings_config[0].query_strings[0].items) == toset(["versionId", "response-content-type", "v"])])
    error_message = "Cache identity must include exact versions, content types, and hashes, but no signature fields."
  }
  assert {
    condition = alltrue(concat(
      [for behavior in aws_cloudfront_distribution.s3_distribution[0].default_cache_behavior : !behavior.compress && toset(behavior.allowed_methods) == toset(["GET", "HEAD", "OPTIONS"])],
      [for behavior in aws_cloudfront_distribution.s3_distribution[0].ordered_cache_behavior : !behavior.compress && length(behavior.trusted_key_groups) == 1],
    ))
    error_message = "All download behaviors must enforce read-only methods, signatures, and byte preservation."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.uploads_oac[0].signing_behavior == "always" && aws_cloudfront_origin_access_control.uploads_oac[0].signing_protocol == "sigv4"
    error_message = "The private S3 origin must always use OAC SigV4."
  }
  assert {
    condition = toset(local.asset_download_object_arns) == toset([
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.glb",
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.json",
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.png",
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.jpg",
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.jpeg",
      "arn:aws:s3:::uploads-dev-283279960672/maps/processed/*.webp",
      "arn:aws:s3:::uploads-dev-283279960672/replays/processed/*.zst",
      "arn:aws:s3:::uploads-dev-283279960672/replays/derived/viewer/*.hsrv",
      "arn:aws:s3:::uploads-dev-283279960672/replays/derived/viewer/*/generations/*/h1-client-diagnostics.v1.*.h1diag",
    ])
    error_message = "CDN access must include generation-bound H1 diagnostic companions and exclude raw maps, unprocessed uploads, manifests, and support-only artifacts."
  }
  assert {
    condition     = aws_cloudfront_cache_policy.assets["mutable"].max_ttl == 300 && aws_cloudfront_cache_policy.assets["immutable"].max_ttl == 31536000
    error_message = "Replaceable keys must have bounded TTLs; immutable generations may cache longer."
  }
}

run "unsigned" {
  state_key = "assets"
  command   = plan
  variables { asset_delivery_mode = "cloudfront" }
  assert {
    condition = (
      length(aws_cloudfront_distribution.s3_distribution[0].default_cache_behavior[0].trusted_key_groups) == 0 &&
      alltrue([for behavior in aws_cloudfront_distribution.s3_distribution[0].ordered_cache_behavior : length(behavior.trusted_key_groups) == 0])
    )
    error_message = "Unsigned mode must permit unsigned requests for every downloadable behavior."
  }
  assert {
    condition     = length(aws_cloudfront_public_key.main) == 1 && length(aws_cloudfront_key_group.main) == 1
    error_message = "Mode switches must retain signing infrastructure."
  }
}

run "signed" {
  state_key = "assets"
  command   = plan
  variables { asset_delivery_mode = "cloudfront_signed" }
  assert {
    condition = (
      length(aws_cloudfront_distribution.s3_distribution[0].default_cache_behavior[0].trusted_key_groups) == 1 &&
      alltrue([for behavior in aws_cloudfront_distribution.s3_distribution[0].ordered_cache_behavior : length(behavior.trusted_key_groups) == 1])
    )
    error_message = "Signed mode must have no unsigned behavior, including cache hits."
  }
}

run "invalid_mode" {
  state_key = "assets"
  command   = plan
  variables { asset_delivery_mode = "public" }
  expect_failures = [var.asset_delivery_mode]
}

run "h1_preserves_canonical_versions" {
  state_key = "assets"
  command   = plan
  variables {
    pipelines = {
      maps = {
        unprocessed_prefix = "maps/unprocessed/"
        processed_prefix   = "maps/processed/"
        failed_prefix      = "maps/failed/"
      }
      replays = {
        unprocessed_prefix = "replays/unprocessed/"
        processed_prefix   = "replays/processed/"
        failed_prefix      = "replays/failed/"
      }
      films = {
        unprocessed_prefix         = "films/unprocessed/"
        preserve_source_versions   = true
        visibility_timeout_seconds = 5400
      }
    }
  }
  assert {
    condition = (
      !contains(keys(local.pipeline_lifecycle_rules), "films-unprocessed") &&
      local.pipeline_lifecycle_rules["maps-processed"].noncurrent_version_expiration_days == 30 &&
      local.pipeline_lifecycle_rules["replays-unprocessed"].noncurrent_version_expiration_days == 7 &&
      local.pipelines.films.unprocessed_prefix == "films/unprocessed/" &&
      aws_sqs_queue.file_processing["films"].visibility_timeout_seconds == 5400 &&
      length(local.asset_download_object_arns) == 9
    )
    error_message = "Keep pinned film versions without broadening CDN access or changing Xbox retention."
  }
}

run "h1_preserves_retained_map_versions" {
  state_key = "assets"
  command   = apply
  variables {
    pipelines = {
      maps = {
        unprocessed_prefix          = "maps/unprocessed/"
        processed_prefix            = "maps/processed/"
        failed_prefix               = "maps/failed/"
        preserve_processed_versions = true
      }
      replays = {
        unprocessed_prefix = "replays/unprocessed/"
        processed_prefix   = "replays/processed/"
        failed_prefix      = "replays/failed/"
      }
      films = {
        unprocessed_prefix       = "films/unprocessed/"
        preserve_source_versions = true
      }
    }
  }
  assert {
    condition = (
      !contains(keys(local.pipeline_lifecycle_rules), "maps-processed") &&
      !contains(keys(local.pipeline_lifecycle_rules), "films-unprocessed") &&
      local.pipeline_lifecycle_rules["maps-unprocessed"].noncurrent_version_expiration_days == 7 &&
      local.pipeline_lifecycle_rules["maps-failed"].expiration_days == 90 &&
      local.pipeline_lifecycle_rules["maps-failed"].noncurrent_version_expiration_days == 7 &&
      local.pipeline_lifecycle_rules["replays-unprocessed"].noncurrent_version_expiration_days == 7 &&
      local.pipeline_lifecycle_rules["replays-processed"].noncurrent_version_expiration_days == 30 &&
      local.pipeline_lifecycle_rules["replays-failed"].expiration_days == 90 &&
      local.pipeline_lifecycle_rules["replays-failed"].noncurrent_version_expiration_days == 7
    )
    error_message = "Preserve processed map originals without changing staging, film, replay or failed-object retention."
  }
  assert {
    condition = alltrue([
      for rule in aws_s3_bucket_lifecycle_configuration.replay_spatial_artifacts.rule :
      length(rule.expiration) == 0 && length(rule.noncurrent_version_expiration) == 0
      if rule.status == "Enabled" && (
        startswith("maps/processed/", try(coalesce(rule.filter[0].prefix, try(rule.filter[0].and[0].prefix, null)), "")) ||
        startswith(try(coalesce(rule.filter[0].prefix, try(rule.filter[0].and[0].prefix, null)), ""), "maps/processed/")
      )
    ])
    error_message = "No effective lifecycle expiration rule may overlap the retained processed-map prefix, even through an ancestor or child prefix."
  }
  assert {
    condition = (
      length(local.asset_download_object_arns) == 9 &&
      !contains(local.asset_download_object_arns, "${local.uploads_bucket_arn}/maps/processed/*.map")
    )
    error_message = "Retaining raw originals must not make them downloadable through CloudFront."
  }
}

run "staging_preservation_keeps_processed_expiry" {
  state_key = "assets"
  command   = plan
  variables {
    pipelines = {
      maps = {
        unprocessed_prefix       = "maps/unprocessed/"
        processed_prefix         = "maps/processed/"
        preserve_source_versions = true
      }
    }
  }
  assert {
    condition = (
      !contains(keys(local.pipeline_lifecycle_rules), "maps-unprocessed") &&
      local.pipeline_lifecycle_rules["maps-processed"].noncurrent_version_expiration_days == 30
    )
    error_message = "The existing staging preservation option must not silently change processed retention."
  }
}

run "cdn_not_provisioned" {
  state_key = "assets"
  command   = plan
  variables {
    asset_delivery_mode = "cloudfront"
    cdn                 = { enabled = false }
  }
  expect_failures = [var.asset_delivery_mode]
}
