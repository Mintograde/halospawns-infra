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
  count = local.trusted_service_hmac_secret_arn == null ? 0 : 1

  statement {
    sid       = "ReadTrustedServiceHmacSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.trusted_service_hmac_secret_arn]
  }
}
