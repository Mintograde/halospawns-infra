data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "terraform_remote_state" "frontend_site" {
  count = var.enabled && var.frontend_site_state_key != null ? 1 : 0

  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.frontend_site_state_key
    region  = var.region
    profile = var.profile
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.enabled && var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprint_list
  tags            = var.tags
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.enabled && !var.create_github_oidc_provider && var.github_oidc_provider_arn == null ? 1 : 0

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
}

data "archive_file" "code_updater" {
  count = var.enabled ? 1 : 0

  type        = "zip"
  source_dir  = "../../../lambda/app_api_code_updater"
  output_path = "${path.module}/app-api-code-updater.zip"
}

data "aws_iam_policy_document" "lambda_assume_role" {
  count = var.enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "code_updater" {
  count = var.enabled ? 1 : 0

  statement {
    sid = "ReadReleaseArtifacts"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.artifacts[0].arn}/${local.normalized_artifact_release_prefix}*"]
  }

  statement {
    sid = "UpdateAppLambdaCode"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
    ]
    resources = [module.app_lambda[0].function_arn]
  }

  statement {
    sid = "UpdateLiveAlias"
    actions = [
      "lambda:GetAlias",
      "lambda:UpdateAlias",
    ]
    resources = [module.app_lambda[0].alias_arn]
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
