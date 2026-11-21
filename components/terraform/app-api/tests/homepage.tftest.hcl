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
    state_keys = {
      frontend_site  = "dev/frontend-site/terraform.tfstate"
      uploads_ingest = "dev/uploads-ingest/terraform.tfstate"
    }
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
      uploads_bucket_name = "dev-uploads"
      uploads_bucket_arn  = "arn:aws:s3:::dev-uploads"
    }
  }
}
override_data {
  target = data.terraform_remote_state.frontend_site[0]
  values = {
    outputs = {
      site_bucket_name            = "dev-site"
      cloudfront_distribution_arn = "arn:aws:cloudfront::283279960672:distribution/TEST"
      cloudfront_distribution_id  = "TEST"
    }
  }
}
run "publisher_disabled_by_default" {
  command = plan
  assert {
    condition     = length(aws_cloudwatch_event_target.homepage_snapshot) == 0 && length(aws_iam_role_policy.homepage_snapshot) == 0
    error_message = "The shared publisher must be explicitly enabled per environment."
  }
}
run "publisher_can_replace_only_the_homepage" {
  command = plan
  variables { homepage_snapshot_enabled = true }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.homepage_snapshot[0].policy).Statement[0].Resource == "arn:aws:s3:::dev-site/data/home/v1.json" &&
      toset(jsondecode(aws_iam_role_policy.homepage_snapshot[0].policy).Statement[0].Action) == toset(["s3:GetObject", "s3:PutObject"]) &&
      jsondecode(aws_iam_role_policy.homepage_snapshot[0].policy).Statement[1].Resource == "arn:aws:cloudfront::283279960672:distribution/TEST" &&
      jsondecode(aws_cloudwatch_event_target.homepage_snapshot[0].input).bucket == "dev-site" &&
      aws_cloudwatch_event_rule.homepage_snapshot[0].schedule_expression == "rate(1 minute)"
    )
    error_message = "Grant the scheduled producer only the homepage object and the site distribution."
  }
}
