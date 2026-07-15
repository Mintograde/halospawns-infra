data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.ecr
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "uploads_ingest" {
  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.uploads_ingest
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "app_api" {
  count = var.dependencies.state_keys.app_api == null ? 0 : 1

  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.app_api
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

data "aws_iam_policy_document" "heatmap_rollup_worker_runtime" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  statement {
    sid       = "ReadGameOccupancyArtifacts"
    actions   = ["s3:GetObject"]
    resources = ["${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.replay_spatial_artifact_prefix}/*"]
  }

  statement {
    sid = "ManageHeatmapRollupArtifacts"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.heatmap_rollup_artifact_prefix}/*"]
  }

  statement {
    sid = "ManageRegionStatRollupArtifacts"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.region_stat_rollup_artifact_prefix}/*"]
  }
}

data "aws_iam_policy_document" "heatmap_rollup_schedule_dlq" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  statement {
    sid       = "AllowEventBridgeScheduleFailures"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.heatmap_rollup_schedule_dlq[0].arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.heatmap_rollup[0].arn]
    }
  }
}

resource "aws_iam_openid_connect_provider" "maps_github" {
  count = var.release.oidc.create_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.release.oidc.thumbprint_list
  tags            = {}
}

data "aws_iam_openid_connect_provider" "github" {
  count = !var.release.oidc.create_provider && (var.release.oidc.provider_arn == null || trimspace(var.release.oidc.provider_arn) == "") ? 1 : 0

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
