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
  description = "Optional remote-state dependencies."
  type = object({
    state_bucket = optional(string)
    state_keys = optional(object({
      environment_dns = optional(string)
    }), {})
  })
  default = {}
}

variable "dns" {
  description = "Frontend domain, hosted zone, certificate, and record-management configuration."
  type = object({
    domain_name = optional(string)
    hosted_zone = optional(object({
      create = optional(bool, false)
      name   = optional(string)
      id     = optional(string)
      key    = optional(string)
    }), {})
    certificate = optional(object({
      create = optional(bool, false)
      arn    = optional(string)
    }), {})
  })
  default = {}

  validation {
    condition     = var.dns.domain_name == null || trimspace(var.dns.domain_name) != ""
    error_message = "dns.domain_name must not be empty when set."
  }

  validation {
    condition     = var.dns.hosted_zone.key == null || trimspace(var.dns.hosted_zone.key) != ""
    error_message = "dns.hosted_zone.key must not be empty when set."
  }

  validation {
    condition     = !var.dns.hosted_zone.create || (var.dns.hosted_zone.id == null && var.dns.hosted_zone.key == null)
    error_message = "A managed hosted zone cannot also use dns.hosted_zone.id or dns.hosted_zone.key."
  }
}

variable "access" {
  description = "Frontend viewer access-control configuration."
  type = object({
    mode                                = optional(string, "public")
    viewer_request_lambda_qualified_arn = optional(string)
    basic_auth = optional(object({
      create_edge_lambda       = optional(bool, false)
      ssm_parameter_name       = optional(string)
      realm                    = optional(string, "Restricted")
      credential_cache_seconds = optional(number, 300)
    }), {})
  })
  default = {}

  validation {
    condition     = contains(["public", "basic_auth"], var.access.mode)
    error_message = "access.mode must be public or basic_auth."
  }

  validation {
    condition = (
      var.access.mode != "basic_auth" ||
      var.access.viewer_request_lambda_qualified_arn != null ||
      (
        var.access.basic_auth.create_edge_lambda &&
        var.access.basic_auth.ssm_parameter_name != null &&
        trimspace(var.access.basic_auth.ssm_parameter_name) != ""
      )
    )
    error_message = "Basic Auth requires an external viewer-request Lambda ARN or a managed edge Lambda with an SSM parameter name."
  }
}

variable "deployment" {
  description = "GitHub Actions deployment identity configuration."
  type = object({
    github = object({
      repository  = string
      environment = optional(string)
      branch      = optional(string, "main")
      oidc = optional(object({
        create_provider = optional(bool, false)
        provider_arn    = optional(string)
      }), {})
    })
  })

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.deployment.github.repository))
    error_message = "deployment.github.repository must be in owner/name form."
  }
}

variable "storage" {
  description = "Frontend bucket lifecycle configuration."
  type = object({
    noncurrent_version_expiration_days = optional(number, 30)
    abort_incomplete_multipart_days    = optional(number, 7)
  })
  default = {}

  validation {
    condition = (
      var.storage.noncurrent_version_expiration_days > 0 &&
      var.storage.abort_incomplete_multipart_days > 0
    )
    error_message = "Frontend storage lifecycle values must use positive day counts."
  }
}

variable "cloudfront" {
  description = "Frontend CloudFront distribution configuration."
  type = object({
    price_class = optional(string, "PriceClass_100")
  })
  default = {}
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}
