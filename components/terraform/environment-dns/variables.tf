variable "region" {
  description = "AWS region used for provider operations."
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

variable "expected_account_id" {
  description = "Optional AWS account ID guard for hosted-zone creation."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.expected_account_id == null || can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must be a 12-digit AWS account ID when set."
  }
}

variable "zones" {
  description = "Delegated public hosted zones keyed by stable logical name."
  type = map(object({
    name          = string
    comment       = optional(string)
    force_destroy = optional(bool, false)
  }))

  validation {
    condition = length(var.zones) > 0 && alltrue([
      for key, zone in var.zones :
      trimspace(key) != "" && trimspace(zone.name) != ""
    ])
    error_message = "zones must contain at least one non-empty key and zone name."
  }

  validation {
    condition     = length(distinct([for zone in values(var.zones) : trimsuffix(lower(trimspace(zone.name)), ".")])) == length(var.zones)
    error_message = "zones must not contain duplicate DNS names."
  }
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}
