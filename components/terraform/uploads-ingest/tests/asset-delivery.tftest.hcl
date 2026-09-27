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
    ])
    error_message = "CDN access must exclude raw maps, unprocessed uploads, manifests, and support-only artifacts."
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

run "cdn_not_provisioned" {
  state_key = "assets"
  command   = plan
  variables {
    asset_delivery_mode = "cloudfront"
    cdn                 = { enabled = false }
  }
  expect_failures = [var.asset_delivery_mode]
}
