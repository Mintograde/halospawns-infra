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
