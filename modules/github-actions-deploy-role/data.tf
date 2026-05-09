locals {
  github_environment_subject = var.github_environment == null || trimspace(var.github_environment) == "" ? null : "repo:${var.github_repository}:environment:${var.github_environment}"
  github_branch_subject      = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
  github_subject             = var.github_subject == null || trimspace(var.github_subject) == "" ? coalesce(local.github_environment_subject, local.github_branch_subject) : var.github_subject
  github_oidc_provider_arn   = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
  role_name                  = var.role_name == null || trimspace(var.role_name) == "" ? "${var.project}-${var.environment}-frontend-deploy" : var.role_name
}

data "aws_iam_policy_document" "assume_role" {
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

data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "ListSiteBucket"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket"
    ]
    resources = [var.site_bucket_arn]
  }

  statement {
    sid = "WriteSiteObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject"
    ]
    resources = ["${var.site_bucket_arn}/*"]
  }

  statement {
    sid = "InvalidateSiteDistribution"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation"
    ]
    resources = [var.cloudfront_distribution_arn]
  }
}
