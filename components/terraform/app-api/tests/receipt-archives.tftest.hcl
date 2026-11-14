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
    github = {
      repository = "Mintograde/halospawns-api"
      oidc       = { provider_arn = "arn:aws:iam::283279960672:oidc-provider/token.actions.githubusercontent.com" }
    }
  }
}

override_resource {
  target          = aws_s3_bucket.artifacts[0]
  override_during = plan
  values = {
    id  = "halospawns-api-artifacts-dev-283279960672"
    arn = "arn:aws:s3:::halospawns-api-artifacts-dev-283279960672"
  }
}

override_data {
  target = data.terraform_remote_state.uploads_ingest[0]
  values = {
    outputs = {
      uploads_bucket_name = "uploads-dev-283279960672"
      uploads_bucket_arn  = "arn:aws:s3:::uploads-dev-283279960672"
    }
  }
}

run "private_versioned_receipt_reader" {
  command = plan
  assert {
    condition = (
      local.app_lambda_environment.H1FILM_RECEIPT_ARCHIVE_BUCKET == "halospawns-api-artifacts-dev-283279960672" &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.actions
      if s.sid == "ReadH1FilmReceiptArchives"])) == toset(["s3:GetObjectVersion"]) &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.resources
        if s.sid == "ReadH1FilmReceiptArchives"])) == toset([
        "arn:aws:s3:::halospawns-api-artifacts-dev-283279960672/database-archive/h1film-completions/*"
      ])
    )
    error_message = "Only exact private receipt object versions may be read by the API."
  }
  assert {
    condition = alltrue([
      for r in aws_s3_bucket_lifecycle_configuration.artifacts[0].rule :
      alltrue([for f in r.filter : !startswith("database-archive/h1film-completions/", f.prefix)])
      if length(r.expiration) > 0 || length(r.noncurrent_version_expiration) > 0
    ])
    error_message = "Receipt archives must remain outside release expiration rules."
  }
}
