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
mock_provider "archive" {}

override_data {
  target = data.terraform_remote_state.uploads_ingest[0]
  values = {
    outputs = {
      uploads_bucket_name = "uploads-dev-283279960672"
      uploads_bucket_arn  = "arn:aws:s3:::uploads-dev-283279960672"
      asset_delivery = {
        mode                       = "cloudfront_signed"
        base_url                   = "https://assets.example.cloudfront.net"
        key_pair_id                = "PUBLICKEYID"
        private_key_parameter_name = "/halospawns/dev/cloudfront/upload-signing/private-key"
        private_key_parameter_arn  = "arn:aws:ssm:us-east-1:283279960672:parameter/halospawns/dev/cloudfront/upload-signing/private-key"
      }
    }
  }
}

variables {
  environment = "dev"
  dependencies = {
    state_bucket = "test-state"
    state_keys   = { uploads_ingest = "dev/uploads-ingest/terraform.tfstate" }
  }
  supabase = {
    project_ref = "test-project"
    url         = "https://test-project.supabase.co"
    jwt         = { create_authorizer = false }
  }
  release = {
    promote_configuration                  = true
    updater_reserved_concurrent_executions = 1
    github = {
      repository = "Mintograde/halospawns-api"
      oidc       = { provider_arn = "arn:aws:iam::283279960672:oidc-provider/token.actions.githubusercontent.com" }
    }
  }
}

run "s3_default_keeps_references" {
  command = plan
  assert {
    condition = (
      length(aws_lambda_invocation.configuration) == 1 &&
      jsondecode(aws_lambda_invocation.configuration[0].input).operation == "promote_configuration" &&
      jsondecode(jsondecode(aws_lambda_invocation.configuration[0].input).configuration_json).Environment.Variables.ASSET_DELIVERY_MODE == "s3" &&
      aws_lambda_invocation.configuration[0].lifecycle_scope == "CREATE_ONLY"
    )
    error_message = "Configuration applies must request promotion through the existing updater, with no destroy-time invocation."
  }
  assert {
    condition = (
      toset(keys(jsondecode(aws_lambda_invocation.configuration[0].input))) == toset(["operation", "configuration_json", "configuration_hash"]) &&
      aws_lambda_invocation.configuration[0].triggers == tomap({ configuration = local.app_configuration_hash }) &&
      jsondecode(aws_lambda_invocation.configuration[0].input).configuration_hash == sha256(jsondecode(aws_lambda_invocation.configuration[0].input).configuration_json)
    )
    error_message = "Promotion must depend only on desired configuration, never application code hashes, versions, or timestamps."
  }
  assert {
    condition     = local.app_lambda_environment.ASSET_DELIVERY_MODE == "s3"
    error_message = "API defaults must preserve S3 presigning."
  }
  assert {
    condition = (
      local.app_lambda_environment.ASSET_CLOUDFRONT_BASE_URL == "https://assets.example.cloudfront.net" &&
      local.app_lambda_environment.ASSET_CLOUDFRONT_KEY_PAIR_ID == "PUBLICKEYID" &&
      local.app_lambda_environment.ASSET_CLOUDFRONT_PRIVATE_KEY_PARAMETER_NAME == "/halospawns/dev/cloudfront/upload-signing/private-key" &&
      contains(local.app_parameter_arns, "arn:aws:ssm:us-east-1:283279960672:parameter/halospawns/dev/cloudfront/upload-signing/private-key")
    )
    error_message = "S3 mode must retain exact signing IAM and non-secret CDN references for future switching."
  }
}

run "signed" {
  command = plan
  variables { asset_delivery_mode = "cloudfront_signed" }
  assert {
    condition     = local.app_lambda_environment.ASSET_DELIVERY_MODE == "cloudfront_signed"
    error_message = "The shared mode must select signed delivery in the Lambda environment."
  }
}

run "s3_preparation_with_existing_outputs" {
  command = plan
  override_data {
    target = data.terraform_remote_state.uploads_ingest[0]
    values = {
      outputs = {
        uploads_bucket_name                       = "uploads-dev-283279960672"
        uploads_bucket_arn                        = "arn:aws:s3:::uploads-dev-283279960672"
        cloudfront_distribution_domain_name       = "assets.example.cloudfront.net"
        cloudfront_key_id                         = "EXISTINGPUBLICKEY"
        upload_signing_private_key_parameter_name = "/halospawns/dev/cloudfront/upload-signing/private-key"
        upload_signing_private_key_parameter_arn  = "arn:aws:ssm:us-east-1:283279960672:parameter/halospawns/dev/cloudfront/upload-signing/private-key"
      }
    }
  }
  assert {
    condition     = local.app_lambda_environment.ASSET_DELIVERY_MODE == "s3" && local.app_lambda_environment.ASSET_CLOUDFRONT_KEY_PAIR_ID == "EXISTINGPUBLICKEY"
    error_message = "Initial S3 preparation must wire existing CDN references before the new uploads contract is applied."
  }
}

run "missing_cdn_contract" {
  command = plan
  variables { asset_delivery_mode = "cloudfront_signed" }
  override_data {
    target = data.terraform_remote_state.uploads_ingest[0]
    values = {
      outputs = {
        uploads_bucket_name = "uploads-dev-283279960672"
        uploads_bucket_arn  = "arn:aws:s3:::uploads-dev-283279960672"
      }
    }
  }
  expect_failures = [terraform_data.required_inputs]
}

run "unsigned" {
  command = plan
  variables { asset_delivery_mode = "cloudfront" }
  override_data {
    target = data.terraform_remote_state.uploads_ingest[0]
    values = {
      outputs = {
        uploads_bucket_name = "uploads-dev-283279960672"
        uploads_bucket_arn  = "arn:aws:s3:::uploads-dev-283279960672"
        asset_delivery = {
          mode                       = "cloudfront"
          base_url                   = "https://assets.example.cloudfront.net"
          key_pair_id                = "PUBLICKEYID"
          private_key_parameter_name = "/halospawns/dev/cloudfront/upload-signing/private-key"
          private_key_parameter_arn  = "arn:aws:ssm:us-east-1:283279960672:parameter/halospawns/dev/cloudfront/upload-signing/private-key"
        }
      }
    }
  }
  assert {
    condition     = local.app_lambda_environment.ASSET_DELIVERY_MODE == "cloudfront"
    error_message = "The shared mode must select unsigned delivery in the Lambda environment."
  }
}

run "mismatched_edge_mode" {
  command = plan
  variables { asset_delivery_mode = "cloudfront" }
  expect_failures = [terraform_data.required_inputs]
}

run "invalid_mode" {
  command = plan
  variables { asset_delivery_mode = "public" }
  expect_failures = [var.asset_delivery_mode]
}

run "configuration_promotion_opt_out" {
  command = plan
  variables {
    release = {
      github = {
        repository = "Mintograde/halospawns-api"
        oidc       = { provider_arn = "arn:aws:iam::283279960672:oidc-provider/token.actions.githubusercontent.com" }
      }
    }
  }
  assert {
    condition     = length(aws_lambda_invocation.configuration) == 0
    error_message = "Existing callers must not acquire automatic configuration promotion by default."
  }
}

run "configuration_promotion_requires_serial_updater" {
  command = plan
  variables {
    release = {
      promote_configuration                  = true
      updater_reserved_concurrent_executions = 2
      github = {
        repository = "Mintograde/halospawns-api"
        oidc       = { provider_arn = "arn:aws:iam::283279960672:oidc-provider/token.actions.githubusercontent.com" }
      }
    }
  }
  expect_failures = [var.release]
}

run "updater_must_acknowledge_configuration" {
  command = plan
  override_resource {
    target          = aws_lambda_invocation.configuration[0]
    override_during = plan
    values          = { result = "{\"statusCode\":200,\"body\":\"{\\\"deployments\\\":[]}\"}" }
  }
  expect_failures = [aws_lambda_invocation.configuration[0]]
}
