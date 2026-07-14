variable "enabled" {
  description = "Whether to create app API resources."
  type        = bool
  default     = true
}

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

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}

variable "dependencies" {
  description = "Remote-state and existing queue dependencies."
  type = object({
    state_bucket = optional(string)
    state_keys = optional(object({
      frontend_site  = optional(string)
      uploads_ingest = optional(string)
    }), {})
    queues = optional(object({
      map_rendering     = optional(string)
      replay_processing = optional(string)
    }), {})
  })
  default = {}
}

variable "domain" {
  description = "App API public URL, custom domain, certificate, and DNS configuration."
  type = object({
    base_url           = optional(string)
    name               = optional(string)
    hosted_zone_id     = optional(string)
    certificate_arn    = optional(string)
    create_certificate = optional(bool, true)
    create_dns_records = optional(bool, true)
  })
  default = {}

  validation {
    condition     = var.domain.base_url == null || can(regex("^https?://", trimspace(var.domain.base_url)))
    error_message = "domain.base_url must start with http:// or https:// when set."
  }
}

variable "cors" {
  description = "App API CORS configuration."
  type = object({
    allowed_origins = optional(set(string), [])
  })
  default = {}
}

variable "supabase" {
  description = "Public Supabase identifiers, JWT configuration, and secret metadata names."
  type = object({
    project_ref = optional(string)
    url         = optional(string)
    jwt = optional(object({
      issuer            = optional(string)
      audience          = optional(string, "authenticated")
      create_authorizer = optional(bool, true)
    }), {})
    secrets = object({
      database_url_name          = string
      service_role_name          = string
      create_service_role_secret = optional(bool, false)
    })
  })
}

variable "uploads" {
  description = "Uploads bucket prefixes and presigned URL behavior exposed to the app API."
  type = object({
    maps = optional(object({
      upload_prefix                 = optional(string, "maps/unprocessed")
      asset_read_prefix             = optional(string, "maps/processed")
      support_resource_prefix       = optional(string, "maps/support-resources")
      support_resource_auto_approve = optional(bool, false)
    }), {})
    replays = optional(object({
      upload_prefix                  = optional(string, "replays/unprocessed")
      asset_read_prefix              = optional(string, "replays/processed")
      spatial_artifact_prefix        = optional(string, "replays/derived/spatial")
      heatmap_rollup_artifact_prefix = optional(string, "replays/derived/heatmap-rollups")
    }), {})
    url_ttl_seconds = optional(number, 900)
  })
  default = {}
}

variable "rendering" {
  description = "Map screenshot render-job contract exposed to the app API."
  type = object({
    output_prefix_template = optional(string, "maps/processed/{upload_id}/screenshots/v1/")
    screenshot_ingest_path = optional(string, "/v1/ingest/map-screenshots")
    render_set = optional(object({
      name    = optional(string, "default-map-screenshots")
      version = optional(number, 1)
    }), {})
  })
  default = {}

  validation {
    condition     = startswith(var.rendering.screenshot_ingest_path, "/")
    error_message = "rendering.screenshot_ingest_path must start with '/'."
  }
}

variable "release" {
  description = "App Lambda runtime, artifact publishing, updater, and GitHub OIDC configuration."
  type = object({
    artifact_prefix = optional(string, "releases/")
    lambda = optional(object({
      runtime         = optional(string, "python3.12")
      handler         = optional(string, "halospawns_api.lambda_handler.handler")
      memory_mb       = optional(number, 512)
      timeout_seconds = optional(number, 30)
      alias_name      = optional(string, "live")
    }), {})
    updater_reserved_concurrent_executions = optional(number)
    github = object({
      repository  = string
      environment = optional(string)
      branch      = optional(string, "main")
      subject     = optional(string)
      oidc = optional(object({
        provider_arn    = optional(string)
        create_provider = optional(bool, false)
        thumbprint_list = optional(list(string), ["6938fd4d98bab03faadb97b34396831e3780aea1"])
      }), {})
    })
  })

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.release.github.repository))
    error_message = "release.github.repository must be in owner/name form."
  }
}

variable "trusted_services" {
  description = "Trusted HMAC client secret metadata and request timestamp tolerance."
  type = object({
    secret_names                = optional(map(string), {})
    timestamp_tolerance_seconds = optional(number)
  })
  default = {}

  validation {
    condition = alltrue([
      for client, secret_name in var.trusted_services.secret_names :
      trimspace(client) != "" && trimspace(secret_name) != ""
    ])
    error_message = "trusted_services.secret_names keys and values must be non-empty."
  }

  validation {
    condition     = var.trusted_services.timestamp_tolerance_seconds == null || var.trusted_services.timestamp_tolerance_seconds > 0
    error_message = "trusted_services.timestamp_tolerance_seconds must be positive when set."
  }
}
