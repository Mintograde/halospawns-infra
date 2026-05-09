variable "project" {
  description = "Project name."
  type        = string
  default     = "halospawns"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "function_name" {
  description = "Lambda@Edge function name."
  type        = string

  validation {
    condition     = trimspace(var.function_name) != ""
    error_message = "function_name must not be empty."
  }
}

variable "ssm_parameter_name" {
  description = "SSM SecureString parameter name containing the Base64 username:password value."
  type        = string

  validation {
    condition     = trimspace(var.ssm_parameter_name) != ""
    error_message = "ssm_parameter_name must not be empty."
  }
}

variable "create_ssm_parameter" {
  description = "Whether Terraform should create the SSM SecureString placeholder parameter."
  type        = bool
  default     = true
}

variable "ssm_placeholder_value" {
  description = "Non-working sentinel value used until the real credential is written manually."
  type        = string
  default     = "REPLACE_ME_DO_NOT_USE"
}

variable "ssm_kms_key_id" {
  description = "Optional customer-managed KMS key ARN or ID for the SSM SecureString parameter."
  type        = string
  default     = null
  nullable    = true
}

variable "ssm_region" {
  description = "Region that contains the SSM credential parameter."
  type        = string
  default     = "us-east-1"
}

variable "basic_auth_realm" {
  description = "HTTP Basic Auth realm shown by browsers."
  type        = string
  default     = "Restricted"
}

variable "credential_cache_ttl_seconds" {
  description = "How long each Lambda@Edge execution environment caches the SSM credential."
  type        = number
  default     = 300

  validation {
    condition     = var.credential_cache_ttl_seconds >= 0 && var.credential_cache_ttl_seconds <= 3600
    error_message = "credential_cache_ttl_seconds must be between 0 and 3600."
  }
}

variable "runtime" {
  description = "Lambda runtime for the edge function."
  type        = string
  default     = "nodejs22.x"
}

variable "timeout" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 5
}

variable "memory_size" {
  description = "Lambda memory size in MB."
  type        = number
  default     = 128
}

variable "aws_sdk_client_ssm_version" {
  description = "npm version range for @aws-sdk/client-ssm packaged with the function."
  type        = string
  default     = "^3.0.0"
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
