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

variable "storage" {
  description = "Uploads bucket configuration."
  type = object({
    bucket_prefix        = optional(string, "uploads")
    allowed_cors_origins = optional(set(string), [])
    replay_spatial_artifacts = optional(object({
      prefix                             = optional(string, "replays/derived/spatial")
      noncurrent_version_expiration_days = optional(number, 30)
      abort_incomplete_multipart_days    = optional(number, 7)
    }), {})
    heatmap_rollup_artifacts = optional(object({
      prefix                             = optional(string, "replays/derived/heatmap-rollups")
      superseded_expiration_days         = optional(number, 30)
      noncurrent_version_expiration_days = optional(number, 30)
      abort_incomplete_multipart_days    = optional(number, 7)
    }), {})
    region_stat_rollup_artifacts = optional(object({
      prefix                             = optional(string, "replays/derived/region-stat-rollups")
      superseded_expiration_days         = optional(number, 30)
      noncurrent_version_expiration_days = optional(number, 30)
      abort_incomplete_multipart_days    = optional(number, 7)
    }), {})
  })
  default = {}

  validation {
    condition     = trimspace(var.storage.bucket_prefix) != ""
    error_message = "storage.bucket_prefix must not be empty."
  }

  validation {
    condition = (
      trim(var.storage.replay_spatial_artifacts.prefix, "/") != "" &&
      var.storage.replay_spatial_artifacts.noncurrent_version_expiration_days > 0 &&
      var.storage.replay_spatial_artifacts.abort_incomplete_multipart_days > 0
    )
    error_message = "Replay spatial artifact lifecycle values must use a non-empty prefix and positive day counts."
  }

  validation {
    condition = (
      trim(var.storage.heatmap_rollup_artifacts.prefix, "/") != "" &&
      var.storage.heatmap_rollup_artifacts.superseded_expiration_days > 0 &&
      var.storage.heatmap_rollup_artifacts.noncurrent_version_expiration_days > 0 &&
      var.storage.heatmap_rollup_artifacts.abort_incomplete_multipart_days > 0
    )
    error_message = "Heatmap rollup artifact lifecycle values must use a non-empty prefix and positive day counts."
  }

  validation {
    condition = (
      trim(var.storage.region_stat_rollup_artifacts.prefix, "/") != "" &&
      var.storage.region_stat_rollup_artifacts.superseded_expiration_days > 0 &&
      var.storage.region_stat_rollup_artifacts.noncurrent_version_expiration_days > 0 &&
      var.storage.region_stat_rollup_artifacts.abort_incomplete_multipart_days > 0
    )
    error_message = "Region-stat rollup artifact lifecycle values must use a non-empty prefix and positive day counts."
  }
}

variable "pipelines" {
  description = "Upload notification and processing queue configuration keyed by stable upload type."
  type = map(object({
    unprocessed_prefix         = string
    processed_prefix           = optional(string)
    failed_prefix              = optional(string)
    visibility_timeout_seconds = optional(number, 300)
    message_retention_seconds  = optional(number, 604800)
    receive_wait_time_seconds  = optional(number, 20)
    max_receive_count          = optional(number, 4)
  }))
  default = {
    maps = {
      unprocessed_prefix         = "maps/unprocessed/"
      processed_prefix           = "maps/processed/"
      failed_prefix              = "maps/failed/"
      visibility_timeout_seconds = 900
    }
    replays = {
      unprocessed_prefix = "replays/unprocessed/"
      processed_prefix   = "replays/processed/"
      failed_prefix      = "replays/failed/"
    }
  }

  validation {
    condition = length(var.pipelines) > 0 && alltrue([
      for name, pipeline in var.pipelines :
      trimspace(name) != "" && trim(pipeline.unprocessed_prefix, "/") != ""
    ])
    error_message = "pipelines must contain at least one non-empty key and unprocessed prefix."
  }

  validation {
    condition = alltrue([
      for pipeline in values(var.pipelines) :
      pipeline.visibility_timeout_seconds > 0 &&
      pipeline.message_retention_seconds > 0 &&
      pipeline.receive_wait_time_seconds >= 0 &&
      pipeline.max_receive_count > 0
    ])
    error_message = "Pipeline queue timeouts and max_receive_count must be valid positive values."
  }
}

variable "observability" {
  description = "Processing queue age and dead-letter queue alarm configuration."
  type = object({
    enabled                     = optional(bool, false)
    queue_age_threshold_seconds = optional(map(number), {})
  })
  default = {}

  validation {
    condition = alltrue([
      for threshold in values(var.observability.queue_age_threshold_seconds) :
      threshold > 0
    ])
    error_message = "observability.queue_age_threshold_seconds values must be positive."
  }
}

variable "cdn" {
  description = "Legacy signed-upload CloudFront configuration. Key values are seeded outside Terraform."
  type = object({
    domain_name               = optional(string)
    private_key_secret_name   = optional(string)
    public_key_parameter_name = optional(string)
    public_key_name           = optional(string, "s3-upload-key")
    key_group_name            = optional(string, "s3-upload-key-group")
    price_class               = optional(string, "PriceClass_All")
  })
  default = {}

  validation {
    condition     = var.cdn.domain_name == null || trimspace(var.cdn.domain_name) != ""
    error_message = "cdn.domain_name must not be empty when set."
  }
}
