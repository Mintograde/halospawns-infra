data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  ssm_parameter_resource_path = startswith(var.ssm_parameter_name, "/") ? var.ssm_parameter_name : "/${var.ssm_parameter_name}"
  ssm_parameter_arn           = "arn:${data.aws_partition.current.partition}:ssm:${var.ssm_region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_parameter_resource_path}"

  auth_index_js = templatefile("${path.module}/auth.js.tftpl", {
    ssm_parameter_name_json      = jsonencode(var.ssm_parameter_name)
    ssm_region_json              = jsonencode(var.ssm_region)
    basic_auth_realm_json        = jsonencode(var.basic_auth_realm)
    credential_cache_ttl_seconds = var.credential_cache_ttl_seconds
    ssm_placeholder_value_json   = jsonencode(var.ssm_placeholder_value)
  })

  package_build_dir    = abspath("${path.module}/.build/${var.function_name}")
  package_output_path  = abspath("${path.module}/.build/${var.function_name}.zip")
  package_dependencies = { "@aws-sdk/client-ssm" = var.aws_sdk_client_ssm_version }
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type = "Service"
      identifiers = [
        "lambda.amazonaws.com",
        "edgelambda.amazonaws.com"
      ]
    }
  }
}

data "aws_iam_policy_document" "ssm_access" {
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.ssm_parameter_arn]
  }

  dynamic "statement" {
    for_each = var.ssm_kms_key_id == null ? [] : [var.ssm_kms_key_id]

    content {
      actions   = ["kms:Decrypt"]
      resources = [statement.value]
    }
  }
}
