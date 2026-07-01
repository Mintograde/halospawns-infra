variable "region" {
  description = "Region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "halospawns"
}

variable "profile" {
  description = "Profile name"
  type        = string
  default     = null
}

variable "tfstate_bucket" {
  description = "S3 bucket containing component Terraform states."
  type        = string
}

variable "ecr_state_key" {
  description = "S3 state key for the ecr component."
  type        = string
}

variable "uploads_ingest_state_key" {
  description = "S3 state key for the uploads-ingest component."
  type        = string
}

variable "app_api_state_key" {
  description = "Optional S3 state key for the app-api component. When set, processor callbacks can read app-api outputs."
  type        = string
  default     = null
  nullable    = true
}

variable "app_api_base_url" {
  description = "Optional explicit app API base URL for processor callbacks. Defaults to the app-api remote-state custom domain or endpoint."
  type        = string
  default     = null
  nullable    = true
}

variable "trusted_service_hmac_client_name" {
  description = "Trusted HMAC client name used by the processor when calling app-api callbacks."
  type        = string
  default     = "map-processing"

  validation {
    condition     = trimspace(var.trusted_service_hmac_client_name) != ""
    error_message = "trusted_service_hmac_client_name must not be empty."
  }
}

variable "legacy_maps_processor_event_source_enabled" {
  description = "Whether the legacy container maps processor SQS event source mapping is enabled."
  type        = bool
  default     = true
}

variable "app_api_processing_status_path_template" {
  description = "Path template for app-api upload processing status callbacks."
  type        = string
  default     = "/v1/uploads/{upload_id}/processing-status"

  validation {
    condition     = startswith(var.app_api_processing_status_path_template, "/")
    error_message = "app_api_processing_status_path_template must start with '/'."
  }
}

variable "app_api_replay_finalization_path" {
  description = "Path for app-api replay finalization callbacks."
  type        = string
  default     = "/v1/ingest/replay-uploads"

  validation {
    condition     = startswith(var.app_api_replay_finalization_path, "/")
    error_message = "app_api_replay_finalization_path must start with '/'."
  }
}

variable "app_api_map_finalization_path" {
  description = "Path for app-api map finalization callbacks."
  type        = string
  default     = "/v1/ingest/map-uploads"

  validation {
    condition     = startswith(var.app_api_map_finalization_path, "/")
    error_message = "app_api_map_finalization_path must start with '/'."
  }
}

variable "app_api_map_support_resource_ingest_path" {
  description = "Path for app-api support-resource ingest callbacks."
  type        = string
  default     = "/v1/ingest/map-support-resources"

  validation {
    condition     = startswith(var.app_api_map_support_resource_ingest_path, "/")
    error_message = "app_api_map_support_resource_ingest_path must start with '/'."
  }
}

variable "app_api_map_support_resource_resolve_path" {
  description = "Path for app-api support-resource resolve callbacks."
  type        = string
  default     = "/v1/ingest/map-support-resources/resolve"

  validation {
    condition     = startswith(var.app_api_map_support_resource_resolve_path, "/")
    error_message = "app_api_map_support_resource_resolve_path must start with '/'."
  }
}

variable "app_api_map_screenshot_ingest_path" {
  description = "Path for app-api map screenshot ingest callbacks."
  type        = string
  default     = "/v1/ingest/map-screenshots"

  validation {
    condition     = startswith(var.app_api_map_screenshot_ingest_path, "/")
    error_message = "app_api_map_screenshot_ingest_path must start with '/'."
  }
}

variable "native_maps_processor_function_name" {
  description = "Optional explicit native maps processor Lambda function name. Defaults to project-maps-processor-environment."
  type        = string
  default     = null
  nullable    = true
}

variable "native_maps_processor_runtime" {
  description = "Runtime for the native maps processor Lambda."
  type        = string
  default     = "python3.14"
}

variable "native_maps_processor_handler" {
  description = "Handler for the native maps processor Lambda package."
  type        = string
  default     = "halo_map.lambda_handler.handler"
}

variable "native_maps_processor_alias_name" {
  description = "Alias used by the SQS trigger and artifact code updater."
  type        = string
  default     = "live"
}

variable "native_maps_processor_timeout" {
  description = "Native maps processor timeout in seconds."
  type        = number
  default     = 900
}

variable "native_maps_processor_memory_size" {
  description = "Native maps processor memory size in MB."
  type        = number
  default     = 2048
}

variable "native_maps_processor_ephemeral_storage_size" {
  description = "Native maps processor ephemeral storage size in MB."
  type        = number
  default     = 10240
}

variable "native_maps_processor_batch_size" {
  description = "SQS batch size for the native maps processor."
  type        = number
  default     = 1
}

variable "native_maps_processor_report_batch_item_failures" {
  description = "Whether the native maps processor SQS mapping enables partial batch failure responses."
  type        = bool
  default     = true
}

variable "native_maps_processor_event_source_enabled" {
  description = "Whether the native maps processor SQS event source mapping is enabled. Keep false until Phase 5 cutover."
  type        = bool
  default     = false
}

variable "native_maps_processor_reserved_concurrent_executions" {
  description = "Reserved concurrency for the native maps processor. Leave null for unreserved."
  type        = number
  default     = null
  nullable    = true
}

variable "native_maps_processor_environment_variables" {
  description = "Additional environment variables for the native maps processor."
  type        = map(string)
  default     = {}
}

variable "native_maps_processor_map_render_enqueue_enabled" {
  description = "Whether the native maps processor enqueues screenshot render jobs after successful map finalization."
  type        = bool
  default     = false
}

variable "map_unprocessed_prefix" {
  description = "S3 prefix for unprocessed map uploads."
  type        = string
  default     = "maps/unprocessed"
}

variable "map_processed_prefix" {
  description = "S3 prefix for processed map assets."
  type        = string
  default     = "maps/processed"
}

variable "map_failed_prefix" {
  description = "S3 prefix for failed map uploads."
  type        = string
  default     = "maps/failed"
}

variable "map_support_resource_prefix" {
  description = "S3 prefix for durable map support-resource objects."
  type        = string
  default     = "maps/support-resources"
}

variable "maps_artifact_release_prefix" {
  description = "S3 prefix that receives native maps processor release ZIP artifacts."
  type        = string
  default     = "releases/"
}

variable "map_renderer_function_name" {
  description = "Optional explicit map renderer Lambda function name. Defaults to project-map-renderer-environment."
  type        = string
  default     = null
  nullable    = true
}

variable "map_renderer_runtime" {
  description = "Managed Lambda runtime for the map renderer shell."
  type        = string
  default     = "nodejs24.x"
}

variable "map_renderer_handler" {
  description = "Handler for the map renderer Lambda package."
  type        = string
  default     = "packages/viewer-renderer/src/lambda/handler.handler"
}

variable "map_renderer_alias_name" {
  description = "Alias used by the SQS trigger and artifact code updater."
  type        = string
  default     = "live"
}

variable "map_renderer_timeout" {
  description = "Map renderer timeout in seconds."
  type        = number
  default     = 300
}

variable "map_renderer_memory_size" {
  description = "Map renderer memory size in MB."
  type        = number
  default     = 2048
}

variable "map_renderer_ephemeral_storage_size" {
  description = "Map renderer ephemeral storage size in MB."
  type        = number
  default     = 2048
}

variable "map_renderer_reserved_concurrent_executions" {
  description = "Reserved concurrency for the map renderer. Keep low in dev because headless browsers are resource heavy."
  type        = number
  default     = 1
  nullable    = true
}

variable "map_renderer_batch_size" {
  description = "SQS batch size for the map renderer."
  type        = number
  default     = 1
}

variable "map_renderer_report_batch_item_failures" {
  description = "Whether the map renderer SQS mapping enables partial batch failure responses."
  type        = bool
  default     = true
}

variable "map_renderer_event_source_enabled" {
  description = "Whether the map renderer SQS event source mapping is enabled."
  type        = bool
  default     = false
}

variable "map_renderer_queue_visibility_timeout_seconds" {
  description = "Visibility timeout for the map rendering queue."
  type        = number
  default     = 360
}

variable "map_renderer_queue_message_retention_seconds" {
  description = "Message retention for the map rendering queue."
  type        = number
  default     = 604800
}

variable "map_renderer_queue_receive_wait_time_seconds" {
  description = "Long polling wait time for the map rendering queue."
  type        = number
  default     = 20
}

variable "map_renderer_queue_max_receive_count" {
  description = "Receive attempts before map rendering jobs are moved to the DLQ."
  type        = number
  default     = 4
}

variable "map_renderer_trusted_service_hmac_client_name" {
  description = "Trusted HMAC client name used by the renderer when calling app-api callbacks."
  type        = string
  default     = "map-rendering"

  validation {
    condition     = trimspace(var.map_renderer_trusted_service_hmac_client_name) != ""
    error_message = "map_renderer_trusted_service_hmac_client_name must not be empty."
  }
}

variable "map_renderer_artifact_release_prefix" {
  description = "S3 prefix that receives map renderer Lambda ZIP release artifacts."
  type        = string
  default     = "renderer/releases/"
}

variable "map_renderer_render_set_name" {
  description = "Default render set name passed to the renderer."
  type        = string
  default     = "default-map-screenshots"
}

variable "map_renderer_render_set_version" {
  description = "Default render set version passed to the renderer."
  type        = number
  default     = 1
}

variable "map_renderer_environment_variables" {
  description = "Additional environment variables for the map renderer."
  type        = map(string)
  default     = {}
}

variable "map_renderer_code_updater_reserved_concurrent_executions" {
  description = "Reserved concurrency for the map renderer code updater Lambda. Leave null to use account-level unreserved concurrency."
  type        = number
  default     = null
  nullable    = true
}

variable "map_renderer_github_repository" {
  description = "GitHub Svelte repository allowed to upload map renderer release artifacts, in owner/name form."
  type        = string
  default     = "Mintograde/halospawns-svelte"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.map_renderer_github_repository))
    error_message = "map_renderer_github_repository must be in owner/name form."
  }
}

variable "map_renderer_github_environment" {
  description = "GitHub Environment used by the map renderer deploy workflow."
  type        = string
  default     = "dev"
  nullable    = true
}

variable "map_renderer_github_branch" {
  description = "GitHub branch used when map_renderer_github_environment is empty."
  type        = string
  default     = "main"
}

variable "map_renderer_github_subject" {
  description = "Optional explicit GitHub OIDC subject for map renderer artifact publishing. Overrides map_renderer_github_environment/map_renderer_github_branch."
  type        = string
  default     = null
  nullable    = true
}

variable "maps_code_updater_reserved_concurrent_executions" {
  description = "Reserved concurrency for the maps code updater Lambda. Leave null to use account-level unreserved concurrency."
  type        = number
  default     = null
  nullable    = true
}

variable "maps_github_repository" {
  description = "GitHub maps repository allowed to upload native maps processor release artifacts, in owner/name form."
  type        = string
  default     = "Mintograde/halospawns-maps"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.maps_github_repository))
    error_message = "maps_github_repository must be in owner/name form."
  }
}

variable "maps_github_environment" {
  description = "GitHub Environment used by the maps deploy workflow."
  type        = string
  default     = "dev"
  nullable    = true
}

variable "maps_github_branch" {
  description = "GitHub branch used when maps_github_environment is empty."
  type        = string
  default     = "main"
}

variable "maps_github_subject" {
  description = "Optional explicit GitHub OIDC subject for maps artifact publishing. Overrides maps_github_environment/maps_github_branch."
  type        = string
  default     = null
  nullable    = true
}

variable "maps_github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN. When null and maps_github_create_oidc_provider is false, the provider is looked up by URL."
  type        = string
  default     = null
  nullable    = true
}

variable "maps_github_create_oidc_provider" {
  description = "Whether this component should create the account-level GitHub Actions OIDC provider."
  type        = bool
  default     = false
}

variable "maps_github_oidc_thumbprint_list" {
  description = "Thumbprint list for the GitHub Actions OIDC provider when this component creates it."
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
