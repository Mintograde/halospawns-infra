data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.ecr_state_key
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "uploads_ingest" {
  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.uploads_ingest_state_key
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "app_api" {
  count = var.app_api_state_key == null ? 0 : 1

  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.app_api_state_key
    region  = var.region
    profile = var.profile
  }
}

data "aws_iam_policy_document" "trusted_service_hmac_secret" {
  for_each = local.trusted_service_hmac_secret_arns_by_client

  statement {
    sid       = "ReadTrustedServiceHmacSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [each.value]
  }
}

data "archive_file" "maps_code_updater" {
  type        = "zip"
  source_dir  = "../../../lambda/app_api_code_updater"
  output_path = "${path.module}/maps-code-updater.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

data "archive_file" "map_renderer_code_updater" {
  type        = "zip"
  source_dir  = "../../../lambda/app_api_code_updater"
  output_path = "${path.module}/map-renderer-code-updater.zip"
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

resource "aws_iam_openid_connect_provider" "maps_github" {
  count = var.maps_github_create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.maps_github_oidc_thumbprint_list
  tags            = {}
}

data "aws_iam_openid_connect_provider" "github" {
  count = !var.maps_github_create_oidc_provider && (var.maps_github_oidc_provider_arn == null || trimspace(var.maps_github_oidc_provider_arn) == "") ? 1 : 0

  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "maps_artifact_bucket" {
  statement {
    sid    = "DenyInsecureConnections"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.maps_artifacts.arn,
      "${aws_s3_bucket.maps_artifacts.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

data "aws_iam_policy_document" "native_maps_processor_s3" {
  statement {
    sid = "ReadUnprocessedMapsAndSupportResources"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = [
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_unprocessed_prefix}/*",
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_support_resource_prefix}/*",
    ]
  }

  statement {
    sid     = "WriteProcessedFailedAndSupportResourceMaps"
    actions = ["s3:PutObject"]
    resources = [
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_processed_prefix}/*",
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_failed_prefix}/*",
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_support_resource_prefix}/*",
    ]
  }

  statement {
    sid       = "DeleteUnprocessedMapsAfterFinalization"
    actions   = ["s3:DeleteObject"]
    resources = ["${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_unprocessed_prefix}/*"]
  }
}

data "aws_iam_policy_document" "native_maps_processor_map_rendering" {
  statement {
    sid       = "SendMapRenderingJobs"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.map_rendering.arn]
  }
}

data "aws_iam_policy_document" "map_renderer_runtime" {
  statement {
    sid     = "ReadProcessedMapGlbs"
    actions = ["s3:GetObject"]
    resources = [
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_processed_prefix}/*/*.glb",
    ]
  }

  statement {
    sid     = "WriteMapScreenshots"
    actions = ["s3:PutObject"]
    resources = [
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.map_processed_prefix}/*/screenshots/*",
    ]
  }

  dynamic "statement" {
    for_each = local.map_renderer_trusted_service_hmac_secret_arn == null ? [] : [local.map_renderer_trusted_service_hmac_secret_arn]

    content {
      sid       = "ReadTrustedServiceHmacSecret"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [statement.value]
    }
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "maps_code_updater" {
  statement {
    sid = "ReadReleaseArtifacts"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.maps_artifacts.arn}/${local.normalized_maps_artifact_release_prefix}*"]
  }

  statement {
    sid = "UpdateNativeMapsProcessorCode"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
    ]
    resources = [module.native_maps_processor.function_arn]
  }

  statement {
    sid = "UpdateLiveAlias"
    actions = [
      "lambda:GetAlias",
      "lambda:UpdateAlias",
    ]
    resources = [
      module.native_maps_processor.function_arn,
      module.native_maps_processor.alias_arn,
    ]
  }
}

data "aws_iam_policy_document" "map_renderer_code_updater" {
  statement {
    sid = "ReadReleaseArtifacts"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.maps_artifacts.arn}/${local.normalized_map_renderer_release_prefix}*"]
  }

  statement {
    sid = "UpdateMapRendererCode"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
    ]
    resources = [module.map_renderer.function_arn]
  }

  statement {
    sid = "UpdateLiveAlias"
    actions = [
      "lambda:GetAlias",
      "lambda:UpdateAlias",
    ]
    resources = [
      module.map_renderer.function_arn,
      module.map_renderer.alias_arn,
    ]
  }
}

data "aws_iam_policy_document" "maps_github_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.maps_github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.maps_github_subject]
    }
  }
}

data "aws_iam_policy_document" "map_renderer_github_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.maps_github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.map_renderer_github_subject]
    }
  }
}

data "aws_iam_policy_document" "maps_github_deploy" {
  statement {
    sid       = "GetArtifactBucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.maps_artifacts.arn]
  }

  statement {
    sid       = "ListReleasePrefix"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.maps_artifacts.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.normalized_maps_artifact_release_prefix}*"]
    }
  }

  statement {
    sid = "WriteReleaseArtifacts"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.maps_artifacts.arn}/${local.normalized_maps_artifact_release_prefix}*"]
  }
}

data "aws_iam_policy_document" "map_renderer_github_deploy" {
  statement {
    sid       = "GetArtifactBucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.maps_artifacts.arn]
  }

  statement {
    sid       = "ListRendererArtifactPrefixes"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.maps_artifacts.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.normalized_map_renderer_release_prefix}*"]
    }
  }

  statement {
    sid = "WriteRendererReleaseArtifacts"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.maps_artifacts.arn}/${local.normalized_map_renderer_release_prefix}*"]
  }

}
