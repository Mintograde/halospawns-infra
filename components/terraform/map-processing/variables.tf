variable "region" {
  description = "Region to deploy resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "project" {
  description = "Project name."
  type        = string
  default     = "halospawns"
}

variable "profile" {
  description = "AWS profile name."
  type        = string
  default     = null
  nullable    = true
}

variable "dependencies" {
  description = "Remote-state dependencies."
  type = object({
    state_bucket = string
    state_keys = object({
      ecr            = string
      uploads_ingest = string
      app_api        = string
    })
  })

  validation {
    condition = (
      trimspace(var.dependencies.state_bucket) != "" &&
      trimspace(var.dependencies.state_keys.ecr) != "" &&
      trimspace(var.dependencies.state_keys.uploads_ingest) != "" &&
      trimspace(var.dependencies.state_keys.app_api) != ""
    )
    error_message = "dependencies state bucket and state keys must not be empty."
  }
}

variable "callbacks" {
  description = "Trusted HMAC client names used for App API callbacks."
  type = object({
    clients = optional(object({
      maps     = optional(string, "map-processing")
      replays  = optional(string, "replay-processing")
      renderer = optional(string, "map-rendering")
      heatmaps = optional(string, "heatmap-processing")
    }), {})
  })
  default = {}

  validation {
    condition     = alltrue([for client in values(var.callbacks.clients) : trimspace(client) != ""])
    error_message = "Callback client names must not be empty."
  }
}

variable "storage" {
  description = "Uploads bucket prefixes used by processing workloads."
  type = object({
    maps = optional(object({
      support_resources = optional(string, "maps/support-resources")
    }), {})
    replays = optional(object({
      spatial_artifacts   = optional(string, "replays/derived/spatial")
      heatmap_rollups     = optional(string, "replays/derived/heatmap-rollups")
      region_stat_rollups = optional(string, "replays/derived/region-stat-rollups")
    }), {})
  })
  default = {}

  validation {
    condition = (
      trim(var.storage.maps.support_resources, "/") != "" &&
      trim(var.storage.replays.spatial_artifacts, "/") != "" &&
      trim(var.storage.replays.heatmap_rollups, "/") != "" &&
      trim(var.storage.replays.region_stat_rollups, "/") != ""
    )
    error_message = "Support-resource and replay artifact storage prefixes must be non-empty."
  }
}

variable "native_maps" {
  description = "Native maps processor Lambda and event-source configuration."
  type = object({
    function_name = optional(string)
    runtime       = optional(string, "python3.14")
    handler       = optional(string, "halo_map.lambda_handler.handler")
    alias_name    = optional(string, "live")
    lambda = optional(object({
      timeout_seconds                = optional(number, 900)
      memory_mb                      = optional(number, 2048)
      ephemeral_storage_mb           = optional(number, 10240)
      reserved_concurrent_executions = optional(number)
      environment_variables          = optional(map(string), {})
    }), {})
    event_source = optional(object({
      enabled                    = optional(bool, false)
      batch_size                 = optional(number, 1)
      report_batch_item_failures = optional(bool, true)
    }), {})
    enqueue_render_jobs = optional(bool, false)
  })
  default = {}
}

variable "replay_parser" {
  description = "Replay parser container Lambda configuration."
  type = object({
    enabled                    = optional(bool, true)
    repository_name            = optional(string, "halospawns-replay-parser")
    timeout_seconds            = optional(number, 300)
    memory_mb                  = optional(number, 2048)
    ephemeral_storage_mb       = optional(number, 10240)
    batch_size                 = optional(number, 1)
    report_batch_item_failures = optional(bool, true)
    event_source_enabled       = optional(bool, true)
    environment_variables      = optional(map(string), {})
  })
  default = {}
}

variable "heatmap_rollup_worker" {
  description = "Scheduled heatmap rollup Lambda, retry, and alarm configuration."
  type = object({
    enabled       = optional(bool, true)
    function_name = optional(string)
    runtime       = optional(string, "python3.14")
    handler       = optional(string, "handler.lambda_handler")
    alias_name    = optional(string, "live")
    lambda = optional(object({
      timeout_seconds                = optional(number, 840)
      memory_mb                      = optional(number, 3008)
      ephemeral_storage_mb           = optional(number, 2048)
      reserved_concurrent_executions = optional(number, 1)
      environment_variables          = optional(map(string), {})
    }), {})
    schedule = optional(object({
      expression                = optional(string, "rate(5 minutes)")
      maximum_event_age_seconds = optional(number, 3600)
      maximum_retry_attempts    = optional(number, 2)
    }), {})
    processing = optional(object({
      input_page_limit          = optional(number, 100)
      max_scopes_per_invocation = optional(number, 4)
      retry_after_seconds       = optional(number, 300)
    }), {})
    region_stats = optional(object({
      enabled               = optional(bool, true)
      max_membership_checks = optional(number, 5000000)
    }), {})
    dlq = optional(object({
      message_retention_seconds = optional(number, 1209600)
    }), {})
    alarms = optional(object({
      enabled                  = optional(bool, true)
      error_evaluation_periods = optional(number, 1)
      duration_threshold_ms    = optional(number, 780000)
    }), {})
  })
  default = {}

  validation {
    condition = (
      var.heatmap_rollup_worker.lambda.timeout_seconds > 0 &&
      var.heatmap_rollup_worker.lambda.timeout_seconds < 900 &&
      var.heatmap_rollup_worker.lambda.memory_mb >= 128 &&
      var.heatmap_rollup_worker.lambda.memory_mb <= 3008 &&
      var.heatmap_rollup_worker.lambda.ephemeral_storage_mb >= 512 &&
      var.heatmap_rollup_worker.lambda.reserved_concurrent_executions > 0 &&
      var.heatmap_rollup_worker.processing.input_page_limit >= 1 &&
      var.heatmap_rollup_worker.processing.input_page_limit <= 250 &&
      var.heatmap_rollup_worker.processing.max_scopes_per_invocation >= 1 &&
      var.heatmap_rollup_worker.processing.max_scopes_per_invocation <= 10 &&
      var.heatmap_rollup_worker.processing.retry_after_seconds >= 30 &&
      var.heatmap_rollup_worker.processing.retry_after_seconds <= 86400 &&
      var.heatmap_rollup_worker.region_stats.max_membership_checks >= 1 &&
      var.heatmap_rollup_worker.region_stats.max_membership_checks <= 100000000 &&
      var.heatmap_rollup_worker.schedule.maximum_event_age_seconds >= 60 &&
      var.heatmap_rollup_worker.schedule.maximum_retry_attempts >= 0 &&
      var.heatmap_rollup_worker.dlq.message_retention_seconds > 0 &&
      var.heatmap_rollup_worker.alarms.error_evaluation_periods > 0 &&
      var.heatmap_rollup_worker.alarms.duration_threshold_ms > 0
    )
    error_message = "Heatmap rollup worker Lambda, processing, retry, DLQ, and alarm values are outside supported bounds."
  }
}

variable "renderer" {
  description = "Map renderer Lambda, queue, render contract, and event-source configuration."
  type = object({
    function_name = optional(string)
    runtime       = optional(string, "nodejs24.x")
    handler       = optional(string, "packages/viewer-renderer/src/lambda/handler.handler")
    alias_name    = optional(string, "live")
    lambda = optional(object({
      timeout_seconds                = optional(number, 300)
      memory_mb                      = optional(number, 2048)
      ephemeral_storage_mb           = optional(number, 2048)
      reserved_concurrent_executions = optional(number)
      environment_variables          = optional(map(string), {})
    }), {})
    event_source = optional(object({
      enabled                    = optional(bool, false)
      batch_size                 = optional(number, 1)
      report_batch_item_failures = optional(bool, true)
    }), {})
    queue = optional(object({
      visibility_timeout_seconds = optional(number, 360)
      message_retention_seconds  = optional(number, 604800)
      receive_wait_time_seconds  = optional(number, 20)
      max_receive_count          = optional(number, 4)
    }), {})
    alarms = optional(object({
      enabled                     = optional(bool, false)
      queue_age_threshold_seconds = optional(number, 300)
    }), {})
    render_set = optional(object({
      name    = optional(string, "default-map-screenshots")
      version = optional(number, 1)
    }), {})
  })
  default = {}

  validation {
    condition     = var.renderer.alarms.queue_age_threshold_seconds > 0
    error_message = "renderer.alarms.queue_age_threshold_seconds must be positive."
  }
}

variable "release" {
  description = "Artifact publishing, code updater, and GitHub OIDC configuration."
  type = object({
    oidc = optional(object({
      provider_arn    = optional(string)
      create_provider = optional(bool, false)
      thumbprint_list = optional(list(string), ["6938fd4d98bab03faadb97b34396831e3780aea1"])
    }), {})
    maps = optional(object({
      artifact_prefix                        = optional(string, "releases/")
      updater_reserved_concurrent_executions = optional(number)
      github = optional(object({
        repository  = optional(string, "Mintograde/halospawns-maps")
        environment = optional(string)
        branch      = optional(string, "main")
        subject     = optional(string)
      }), {})
    }), {})
    renderer = optional(object({
      artifact_prefix                        = optional(string, "renderer/releases/")
      updater_reserved_concurrent_executions = optional(number)
      github = optional(object({
        repository  = optional(string, "Mintograde/halospawns-svelte")
        environment = optional(string)
        branch      = optional(string, "main")
        subject     = optional(string)
      }), {})
    }), {})
  })
  default = {}

  validation {
    condition = alltrue([
      for repository in [var.release.maps.github.repository, var.release.renderer.github.repository] :
      can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repository))
    ])
    error_message = "Release GitHub repositories must be in owner/name form."
  }
}
