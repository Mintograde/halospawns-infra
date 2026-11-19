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

run "cache_disabled_by_default" {
  command = plan
  assert {
    condition = !contains(keys(local.app_lambda_environment), "HEATMAP_RESPONSE_CACHE_BUCKET") && length([
      for s in data.aws_iam_policy_document.app_runtime[0].statement : s if s.sid == "CacheHeatmapResponses"
    ]) == 0
    error_message = "Environments must explicitly enable heatmap caching."
  }
  assert {
    condition = length(local.movement_flow_api_routes) == 0 && length([
      for s in data.aws_iam_policy_document.app_runtime[0].statement : s if s.sid == "ReadMovementFields"
    ]) == 0
    error_message = "Movement callbacks and field reads require an enabled producer."
  }
}

run "movement_field_delivery_and_callback" {
  command = plan
  variables { movement_flow_enabled = true }
  assert {
    condition = (
      one(local.movement_flow_api_routes).route_key == "POST /v1/ingest/movement-flow" &&
      one(local.movement_flow_api_routes).authorization_type == "NONE" &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.actions
      if s.sid == "ReadMovementFields"])) == toset(["s3:GetObject"]) &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.resources
        if s.sid == "ReadMovementFields"])) == toset([
        "arn:aws:s3:::uploads-dev-283279960672/heatmaps/precomputed/v1/movement/views/*.json"
      ])
    )
    error_message = "Enable the trusted callback and read access to movement fields."
  }
}

run "cache_is_private_and_prefix_scoped" {
  command = plan
  variables { heatmap_response_cache_enabled = true }
  assert {
    condition = (
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.actions
      if s.sid == "ReadPrecomputedHeatmapIndexes"])) == toset(["s3:GetObject"]) &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.resources
        if s.sid == "ReadPrecomputedHeatmapIndexes"])) == toset([
        "arn:aws:s3:::uploads-dev-283279960672/heatmaps/precomputed/*/index.json"
      ])
    )
    error_message = "The API reads only small indexes; the producer owns permanent product writes."
  }
  assert {
    condition = (
      local.app_lambda_environment.HEATMAP_RESPONSE_CACHE_BUCKET == "halospawns-api-artifacts-dev-283279960672" &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.actions
      if s.sid == "CacheHeatmapResponses"])) == toset(["s3:GetObject", "s3:PutObject"]) &&
      toset(one([for s in data.aws_iam_policy_document.app_runtime[0].statement : s.resources
        if s.sid == "CacheHeatmapResponses"])) == toset([
        "arn:aws:s3:::halospawns-api-artifacts-dev-283279960672/cache/heatmaps/*"
      ]) && aws_s3_bucket_public_access_block.artifacts[0].block_public_policy
    )
    error_message = "Cache access must stay private and restricted to disposable cache objects."
  }
  assert {
    condition = alltrue([
      for r in aws_s3_bucket_lifecycle_configuration.artifacts[0].rule :
      alltrue([for f in r.filter : f.prefix == "cache/heatmaps/"])
      if startswith(r.id, "heatmap-cache-")
      ]) && length([for r in aws_s3_bucket_lifecycle_configuration.artifacts[0].rule : r
    if startswith(r.id, "heatmap-cache-")]) == 2
    error_message = "Cache expiration must not affect releases or permanent receipt archives."
  }
}
