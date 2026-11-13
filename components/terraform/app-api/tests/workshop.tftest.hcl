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

override_data {
  target = data.terraform_remote_state.uploads_ingest[0]
  values = {
    outputs = {
      uploads_bucket_name      = "uploads-dev-283279960672"
      uploads_bucket_arn       = "arn:aws:s3:::uploads-dev-283279960672"
      file_uploaded_topic_arns = { films = "arn:aws:sns:us-east-1:283279960672:films-uploaded" }
    }
  }
}

run "workshop_opt_in" {
  command = plan
  assert {
    condition     = length(local.workshop_api_routes) == 0 && !contains(keys(local.app_lambda_environment), "WORKSHOP_MAPS_ENABLED")
    error_message = "Workshop discovery must be explicitly enabled."
  }
}

run "workshop_callbacks_and_snapshots" {
  command = plan
  variables {
    workshop_maps_enabled = true
  }
  assert {
    condition = (
      local.app_lambda_environment.WORKSHOP_MAPS_ENABLED == "true" &&
      local.app_lambda_environment.WORKSHOP_FILMS_TOPIC_ARN == "arn:aws:sns:us-east-1:283279960672:films-uploaded" &&
      length(local.workshop_api_routes) == 4 &&
      alltrue([for route in local.workshop_api_routes : route.authorization_type == "NONE"])
    )
    error_message = "Workshop callbacks must use the application HMAC contract and the existing film topic."
  }
  assert {
    condition = toset(one([
      for statement in data.aws_iam_policy_document.app_runtime[0].statement : statement.resources
      if statement.sid == "ReadImmutableWorkshopMaps"
    ])) == toset(["arn:aws:s3:::uploads-dev-283279960672/workshop/maps/*"])
    error_message = "The API must only read Workshop snapshots within the immutable prefix."
  }
}
