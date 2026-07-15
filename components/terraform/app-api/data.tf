data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "terraform_remote_state" "frontend_site" {
  count = var.enabled && var.dependencies.state_keys.frontend_site != null ? 1 : 0

  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.frontend_site
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "uploads_ingest" {
  count = var.enabled && var.dependencies.state_keys.uploads_ingest != null ? 1 : 0

  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.uploads_ingest
    region  = var.region
    profile = var.profile
  }
}

data "aws_sqs_queue" "map_rendering" {
  count = var.enabled && local.map_rendering_queue_name != null ? 1 : 0

  name = local.map_rendering_queue_name
}

data "aws_sqs_queue" "replay_processing" {
  count = var.enabled && local.replay_processing_queue_name != null ? 1 : 0

  name = local.replay_processing_queue_name
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.enabled && var.release.github.oidc.create_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.release.github.oidc.thumbprint_list
  tags            = var.tags
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.enabled && !var.release.github.oidc.create_provider && var.release.github.oidc.provider_arn == null ? 1 : 0

  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "artifact_bucket" {
  count = var.enabled ? 1 : 0

  statement {
    sid    = "DenyInsecureConnections"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.artifacts[0].arn,
      "${aws_s3_bucket.artifacts[0].arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

data "aws_iam_policy_document" "app_runtime" {
  count = var.enabled ? 1 : 0

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.app_secret_arns
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "PresignUploadPutObjects"
      actions   = ["s3:PutObject"]
      resources = local.upload_put_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "PresignProcessedMapGetObjects"
      actions   = ["s3:GetObject"]
      resources = local.map_asset_get_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "PresignProcessedReplayGetObjects"
      actions   = ["s3:GetObject"]
      resources = local.replay_asset_get_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "ReadReplaySpatialArtifacts"
      actions   = ["s3:GetObject"]
      resources = local.replay_spatial_artifact_get_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "ReadHeatmapRollupArtifacts"
      actions   = ["s3:GetObject"]
      resources = local.heatmap_rollup_artifact_get_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "ReadRegionStatRollupArtifacts"
      actions   = ["s3:GetObject"]
      resources = local.region_stat_rollup_artifact_get_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.uploads_bucket_arn == null ? [] : [1]

    content {
      sid       = "DeleteMapSupportResourceObjects"
      actions   = ["s3:DeleteObject"]
      resources = local.map_support_resource_delete_object_resource_arns
    }
  }

  dynamic "statement" {
    for_each = local.map_rendering_queue_arn == null ? [] : [local.map_rendering_queue_arn]

    content {
      sid       = "SendMapRenderingJobs"
      actions   = ["sqs:SendMessage"]
      resources = [statement.value]
    }
  }

  dynamic "statement" {
    for_each = local.replay_processing_queue_arn == null ? [] : [local.replay_processing_queue_arn]

    content {
      sid       = "SendReplayProcessingJobs"
      actions   = ["sqs:SendMessage"]
      resources = [statement.value]
    }
  }
}

data "aws_iam_policy_document" "github_assume_role" {
  count = var.enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_subject]
    }
  }
}

data "aws_iam_policy_document" "github_deploy" {
  count = var.enabled ? 1 : 0

  statement {
    sid       = "GetArtifactBucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.artifacts[0].arn]
  }

  statement {
    sid       = "ListReleasePrefix"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts[0].arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.normalized_artifact_release_prefix}*"]
    }
  }

  statement {
    sid = "WriteReleaseArtifacts"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.artifacts[0].arn}/${local.normalized_artifact_release_prefix}*"]
  }
}
