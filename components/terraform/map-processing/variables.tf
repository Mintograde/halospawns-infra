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
