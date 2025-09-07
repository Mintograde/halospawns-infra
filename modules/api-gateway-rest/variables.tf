variable "api_name" {
  description = "Name of the REST API"
  type        = string
}

variable "stage_name" {
  description = "Deployment stage name"
  type        = string
}

variable "routes" {
  description = "List of route definitions (path, method, lambda_arn, optional api_key_required)"
  type = list(object({
    path             = string
    method           = string
    lambda_arn       = string
    api_key_required = optional(bool)
  }))
}

variable "usage_plan" {
  description = "Usage plan configuration (object with enabled and optional fields)"
  type        = any
  default     = null
}

variable "create_api_key" {
  description = "Whether to create an API key when usage_plan is enabled; defaults to usage_plan.enabled"
  type        = bool
  default     = null
}

variable "tags" {
  description = "Tags to apply"
  type        = map(string)
  default     = {}
}
