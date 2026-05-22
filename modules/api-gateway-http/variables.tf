variable "name" {
  description = "HTTP API name."
  type        = string

  validation {
    condition     = trimspace(var.name) != ""
    error_message = "name must not be empty."
  }
}

variable "description" {
  description = "Optional HTTP API description."
  type        = string
  default     = null
  nullable    = true
}

variable "stage_name" {
  description = "HTTP API stage name."
  type        = string
  default     = "$default"
}

variable "enable_access_logs" {
  description = "Whether to write HTTP API stage access logs to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "access_log_retention_days" {
  description = "CloudWatch retention period for HTTP API access logs."
  type        = number
  default     = 30
}

variable "lambda_invoke_arn" {
  description = "Lambda function or alias invoke ARN used by the proxy integration."
  type        = string
}

variable "lambda_function_name" {
  description = "Lambda function name used for API Gateway invoke permission."
  type        = string
}

variable "lambda_alias_name" {
  description = "Optional Lambda alias qualifier used for API Gateway invoke permission."
  type        = string
  default     = null
  nullable    = true
}

variable "routes" {
  description = "HTTP API routes integrated with the Lambda proxy."
  type = list(object({
    route_key          = string
    authorization_type = optional(string, "NONE")
  }))

  validation {
    condition = alltrue([
      for route in var.routes : contains(["NONE", "JWT"], route.authorization_type)
    ])
    error_message = "Each route authorization_type must be NONE or JWT."
  }
}

variable "jwt_authorizer" {
  description = "Optional native JWT authorizer configuration."
  type = object({
    name             = optional(string)
    issuer           = string
    audience         = list(string)
    identity_sources = optional(list(string), ["$request.header.Authorization"])
  })
  default  = null
  nullable = true
}

variable "cors_allowed_origins" {
  description = "Allowed CORS origins. Empty disables API Gateway CORS configuration."
  type        = list(string)
  default     = []
}

variable "cors_allowed_headers" {
  description = "Allowed CORS request headers."
  type        = list(string)
  default     = ["Authorization", "Content-Type"]
}

variable "cors_allowed_methods" {
  description = "Allowed CORS methods."
  type        = list(string)
  default     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}

variable "cors_max_age_seconds" {
  description = "CORS preflight cache duration in seconds."
  type        = number
  default     = 300
}

variable "domain_name" {
  description = "Optional custom domain name for the HTTP API."
  type        = string
  default     = null
  nullable    = true
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for custom domain records and certificate validation."
  type        = string
  default     = null
  nullable    = true
}

variable "certificate_arn" {
  description = "Existing ACM certificate ARN for the custom domain."
  type        = string
  default     = null
  nullable    = true
}

variable "create_certificate" {
  description = "Whether to create and validate an ACM certificate for the custom domain."
  type        = bool
  default     = false
}

variable "create_dns_records" {
  description = "Whether to create Route 53 validation and alias records."
  type        = bool
  default     = true
}

variable "create_aaaa_record" {
  description = "Whether to create an AAAA alias record for the custom domain."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
