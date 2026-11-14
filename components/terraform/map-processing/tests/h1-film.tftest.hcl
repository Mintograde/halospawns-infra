mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "283279960672" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_ecr_image" {
    defaults = { image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}
mock_provider "archive" {}

variables {
  environment = "dev"
  dependencies = {
    state_bucket = "fixture-state"
    state_keys   = { ecr = "ecr", uploads_ingest = "uploads", app_api = "api" }
  }
  replay_parser         = { enabled = false }
  heatmap_rollup_worker = { enabled = false }
  h1_film               = { enabled = true, image_tag = "fixture-v1", memory_mb = 3008 }
}

override_data {
  target = data.terraform_remote_state.ecr
  values = { outputs = { repository_urls = {
    halospawns-h1-film       = "283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film"
    halospawns-workshop-maps = "283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-workshop-maps"
  } } }
}
override_data {
  target = data.terraform_remote_state.app_api
  values = { outputs = {
    api_contract = {
      base_url                     = "https://api.dev.halospawns.com"
      upload_processing_status     = "/v1/uploads/{upload_id}/processing-status"
      map_finalization             = "/v1/ingest/map-uploads"
      map_screenshot_ingest        = "/v1/ingest/map-screenshots"
      map_support_resource_ingest  = "/v1/ingest/map-support-resources"
      map_support_resource_resolve = "/v1/ingest/map-support-resources/resolve"
    }
    trusted_service_hmac_parameter_names = {
      h1-film        = "/fixture/h1"
      map-processing = "/fixture/maps"
      map-rendering  = "/fixture/renderer"
      workshop-maps  = "/fixture/workshop-hmac"
    }
    trusted_service_hmac_parameter_arns = {
      h1-film        = "arn:aws:ssm:us-east-1:283279960672:parameter/fixture/h1"
      map-processing = "arn:aws:ssm:us-east-1:283279960672:parameter/fixture/maps"
      map-rendering  = "arn:aws:ssm:us-east-1:283279960672:parameter/fixture/renderer"
    }
  } }
}
override_data {
  target = data.terraform_remote_state.uploads_ingest
  values = { outputs = {
    uploads_bucket_arn       = "arn:aws:s3:::fixture-uploads"
    uploads_bucket_name      = "fixture-uploads"
    file_uploaded_topic_arns = { films = "arn:aws:sns:us-east-1:283279960672:films" }
    pipelines = {
      films = { unprocessed_prefix = "films/unprocessed/", queue_arn = "arn:aws:sqs:us-east-1:283279960672:films" }
      maps = {
        unprocessed_prefix = "maps/unprocessed/", processed_prefix = "maps/processed/", failed_prefix = "maps/failed/"
        queue_arn          = "arn:aws:sqs:us-east-1:283279960672:maps"
      }
      replays = {
        unprocessed_prefix = "replays/unprocessed/", processed_prefix = "replays/processed/", failed_prefix = "replays/failed/"
        queue_arn          = "arn:aws:sqs:us-east-1:283279960672:replays"
      }
    }
  } }
}

run "foundation_has_no_intake_permissions_or_mapping" {
  command = plan
  assert {
    condition = (
      length(aws_iam_role_policy.h1_film_intake) == 0 &&
      length(aws_lambda_event_source_mapping.h1_film) == 0 &&
      aws_lambda_function.h1_film[0].reserved_concurrent_executions == 0
    )
    error_message = "Foundation must remain isolated."
  }
}
run "intake_is_wired_but_disabled" {
  command = plan
  variables {
    h1_film = { enabled = true, image_tag = "fixture-v1", memory_mb = 3008, intake_configured = true }
  }
  assert {
    condition = (
      aws_lambda_function.h1_film[0].environment[0].variables.H1_WORKER_MODE == "intake" &&
      aws_lambda_function.h1_film[0].reserved_concurrent_executions == 0 &&
      !aws_lambda_event_source_mapping.h1_film[0].enabled &&
      aws_lambda_event_source_mapping.h1_film[0].batch_size == 1 &&
      !contains(flatten([for s in jsondecode(aws_iam_role_policy.h1_film_intake[0].policy).Statement : s.Action]), "s3:DeleteObject")
    )
    error_message = "Wiring must not activate consumption or permit source deletion."
  }
}
run "activation_requires_concurrency" {
  command = plan
  variables {
    h1_film = { enabled = true, image_tag = "fixture-v1", intake_configured = true, event_source_enabled = true }
  }
  expect_failures = [var.h1_film]
}
run "intake_supports_five_concurrent_films" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 5
    }
  }
  assert {
    condition = (
      aws_lambda_function.h1_film[0].reserved_concurrent_executions == 5 &&
      aws_lambda_event_source_mapping.h1_film[0].enabled &&
      aws_lambda_event_source_mapping.h1_film[0].batch_size == 1 &&
      length(aws_lambda_event_source_mapping.h1_film[0].scaling_config) == 0 &&
      contains(aws_lambda_event_source_mapping.h1_film[0].function_response_types, "ReportBatchItemFailures")
    )
    error_message = "Five concurrent invocations must retain one film per invocation and partial failure reporting."
  }
}
run "intake_supports_fifty_concurrent_films_with_queue_cap" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 50
      maximum_concurrency  = 50
    }
  }
  assert {
    condition = (
      aws_lambda_function.h1_film[0].reserved_concurrent_executions == 50 &&
      aws_lambda_event_source_mapping.h1_film[0].scaling_config[0].maximum_concurrency == 50 &&
      aws_lambda_event_source_mapping.h1_film[0].enabled &&
      aws_lambda_event_source_mapping.h1_film[0].batch_size == 1 &&
      contains(aws_lambda_event_source_mapping.h1_film[0].function_response_types, "ReportBatchItemFailures")
    )
    error_message = "Fifty concurrent films must keep the queue cap within the reservation and preserve per-message failures."
  }
}
run "queue_cap_above_reservation_is_rejected" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 5
      maximum_concurrency  = 6
    }
  }
  expect_failures = [var.h1_film]
}
run "queue_cap_below_aws_minimum_is_rejected" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 5
      maximum_concurrency  = 1
    }
  }
  expect_failures = [var.h1_film]
}
run "fractional_queue_cap_is_rejected" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 5
      maximum_concurrency  = 4.5
    }
  }
  expect_failures = [var.h1_film]
}
run "concurrency_above_fifty_is_rejected" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 51
    }
  }
  expect_failures = [var.h1_film]
}
run "fractional_concurrency_is_rejected" {
  command = plan
  variables {
    h1_film = {
      enabled              = true
      image_tag            = "fixture-v1"
      memory_mb            = 3008
      intake_configured    = true
      event_source_enabled = true
      reserved_concurrency = 4.5
    }
  }
  expect_failures = [var.h1_film]
}
run "intake_requires_resource_headroom" {
  command = plan
  variables {
    h1_film = { enabled = true, image_tag = "fixture-v1", memory_mb = 128, intake_configured = true }
  }
  expect_failures = [aws_lambda_function.h1_film]
}
run "prod_is_not_authorized" {
  command = plan
  variables { environment = "prod" }
  expect_failures = [aws_lambda_function.h1_film]
}

run "workshop_session_permissions_are_scoped" {
  command = plan
  override_resource {
    target          = aws_cloudwatch_log_group.workshop[0]
    override_during = plan
    values          = { arn = "arn:aws:logs:us-east-1:283279960672:log-group:/aws/lambda/fixture-workshop" }
  }
  variables {
    workshop_maps = {
      enabled                     = true
      image_tag                   = "git-1111111111111111111111111111111111111111"
      steam_credentials_parameter = "/fixture/steam-credentials"
      steam_session_parameter     = "/fixture/steam-session"
    }
  }
  assert {
    condition     = aws_lambda_function.workshop[0].environment[0].variables.WORKSHOP_STEAM_SESSION_PARAMETER == "/fixture/steam-session"
    error_message = "The worker must receive only the session parameter name."
  }
  assert {
    condition     = [for statement in jsondecode(aws_iam_role_policy.workshop[0].policy).Statement : statement.Resource if contains(statement.Action, "ssm:PutParameter")] == ["arn:aws:ssm:us-east-1:283279960672:parameter/fixture/steam-session"]
    error_message = "The worker may update only its session, never the account credentials or HMAC."
  }
  assert {
    condition     = aws_lambda_function.workshop[0].reserved_concurrent_executions == 1
    error_message = "One Steam session must have one scheduled consumer."
  }
}

run "workshop_session_cannot_overwrite_credentials" {
  command = plan
  variables {
    workshop_maps = {
      steam_credentials_parameter = "/fixture/same"
      steam_session_parameter     = "/fixture/same"
    }
  }
  expect_failures = [var.workshop_maps]
}

run "workshop_session_requires_account_identity" {
  command = plan
  variables { workshop_maps = { steam_session_parameter = "/fixture/session" } }
  expect_failures = [var.workshop_maps]
}
