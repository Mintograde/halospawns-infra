variable "region" {
  description = "AWS region used by the generated S3 backend configuration."
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
  description = "AWS profile used by the generated S3 backend configuration."
  type        = string
  default     = null
  nullable    = true
}

variable "enabled" {
  description = "Whether Terraform should manage the selected Supabase project settings."
  type        = bool
  default     = false
}

variable "project_ref" {
  description = "Existing Supabase project reference. This component never creates or imports a Supabase project."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{20}$", var.project_ref))
    error_message = "project_ref must be a 20-character lowercase alphanumeric Supabase project reference."
  }
}

variable "settings" {
  description = "Allowlisted, non-secret Supabase settings to manage selectively."
  type = object({
    api = optional(object({
      db_schema            = optional(string)
      db_extra_search_path = optional(string)
      max_rows             = optional(number)
      db_pool              = optional(number)
    }))
    auth = optional(object({
      site_url                         = optional(string)
      uri_allow_list                   = optional(string)
      disable_signup                   = optional(bool)
      external_anonymous_users_enabled = optional(bool)
      jwt_exp                          = optional(number)
      mailer_autoconfirm               = optional(bool)
    }))
    network_restrictions = optional(list(string))
  })
  default = {}

  validation {
    condition     = try(var.settings.api.max_rows == null || var.settings.api.max_rows > 0, true)
    error_message = "settings.api.max_rows must be greater than zero when set."
  }

  validation {
    condition     = try(var.settings.api.db_pool == null || var.settings.api.db_pool > 0, true)
    error_message = "settings.api.db_pool must be greater than zero when set."
  }

  validation {
    condition = try(
      var.settings.auth.site_url == null ||
      can(regex("^https?://", var.settings.auth.site_url)),
      true
    )
    error_message = "settings.auth.site_url must use http:// or https:// when set."
  }

  validation {
    condition     = try(var.settings.auth.jwt_exp == null || var.settings.auth.jwt_exp > 0, true)
    error_message = "settings.auth.jwt_exp must be greater than zero when set."
  }

  validation {
    condition = try(
      length(var.settings.network_restrictions) > 0 &&
      alltrue([for cidr in var.settings.network_restrictions : can(cidrhost(cidr, 0))]),
      true
    )
    error_message = "settings.network_restrictions must be non-empty and contain only valid CIDRs when set."
  }
}
