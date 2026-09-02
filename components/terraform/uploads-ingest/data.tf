data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "immutable_replay_writes" {
  statement {
    sid       = "DenyUnconditionalImmutableReplayWrites"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = local.immutable_replay_object_arns

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Null"
      variable = "s3:if-none-match"
      values   = ["true"]
    }

    condition {
      test     = "Bool"
      variable = "s3:ObjectCreationOperation"
      values   = ["true"]
    }
  }
}

data "terraform_remote_state" "environment_dns" {
  count = (
    var.dependencies.state_bucket != null &&
    var.dependencies.state_keys.environment_dns != null &&
    var.cdn.hosted_zone_key != null
  ) ? 1 : 0

  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.environment_dns
    region  = var.region
    profile = var.profile
  }
}
