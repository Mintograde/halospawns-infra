variable "project" {
  description = "Project name."
  type        = string
  default     = "halospawns"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "bucket_prefix" {
  description = "Prefix for the static site bucket name."
  type        = string
}

variable "retention" {
  description = "Retention for noncurrent site objects and incomplete multipart uploads."
  type = object({
    noncurrent_version_expiration_days = optional(number, 30)
    abort_incomplete_multipart_days    = optional(number, 7)
  })
  default = {}

  validation {
    condition = (
      var.retention.noncurrent_version_expiration_days > 0 &&
      var.retention.abort_incomplete_multipart_days > 0
    )
    error_message = "Static-site lifecycle values must use positive day counts."
  }
}

variable "domain_name" {
  description = "Primary custom domain name for the site. Leave null to use the CloudFront default domain."
  type        = string
  default     = null
  nullable    = true
}

variable "aliases" {
  description = "Additional CloudFront aliases for the site."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate ARN for CloudFront aliases."
  type        = string
  default     = null
  nullable    = true
}

variable "create_certificate" {
  description = "Whether to create and validate an ACM certificate for the site aliases."
  type        = bool
  default     = false
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID used for ACM validation records and site aliases."
  type        = string
  default     = null
  nullable    = true
}

variable "create_dns_records" {
  description = "Whether to create Route 53 alias records and ACM DNS validation records in hosted_zone_id."
  type        = bool
  default     = true
}

variable "default_root_object" {
  description = "CloudFront default root object."
  type        = string
  default     = "index.html"
}

variable "spa_fallback_enabled" {
  description = "Whether CloudFront should route 403/404 responses to index.html."
  type        = bool
  default     = true
}

variable "public_spa_mount" {
  description = "Optional public SPA mount served by ordered CloudFront behaviors outside the default access control."
  type = object({
    path_prefix    = string
    index_document = optional(string, "index.html")
  })
  default  = null
  nullable = true

  validation {
    condition = var.public_spa_mount == null ? true : (
      can(regex("^/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$", var.public_spa_mount.path_prefix)) &&
      alltrue([
        for segment in split("/", trimprefix(var.public_spa_mount.path_prefix, "/")) :
        !contains([".", ".."], segment)
      ])
    )
    error_message = "public_spa_mount.path_prefix must be a non-root absolute path without wildcards, a trailing slash, or dot segments."
  }

  validation {
    condition = var.public_spa_mount == null ? true : (
      can(regex("^[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$", var.public_spa_mount.index_document)) &&
      alltrue([
        for segment in split("/", var.public_spa_mount.index_document) :
        !contains([".", ".."], segment)
      ])
    )
    error_message = "public_spa_mount.index_document must be a relative object path without wildcards or dot segments."
  }
}

variable "access_control_mode" {
  description = "Viewer access control mode."
  type        = string
  default     = "public"

  validation {
    condition     = contains(["public", "basic_auth"], var.access_control_mode)
    error_message = "access_control_mode must be either public or basic_auth."
  }
}

variable "viewer_request_lambda_qualified_arn" {
  description = "Published Lambda@Edge version ARN for viewer-request access control."
  type        = string
  default     = null
  nullable    = true
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
