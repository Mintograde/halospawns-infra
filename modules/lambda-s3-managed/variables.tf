variable "function_name" {
  description = "Name of the Lambda function."
  type        = string

  validation {
    condition     = trimspace(var.function_name) != ""
    error_message = "function_name must not be empty."
  }
}

variable "runtime" {
  description = "Lambda runtime."
  type        = string
}

variable "handler" {
  description = "Lambda handler."
  type        = string
}

variable "source_dir" {
  description = "Directory containing the bootstrap Lambda source package."
  type        = string
}

variable "output_path" {
  description = "Optional path for the generated bootstrap zip."
  type        = string
  default     = null
  nullable    = true
}

variable "alias_name" {
  description = "Alias name used by callers for externally deployed code."
  type        = string
  default     = "live"
}

variable "timeout" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 10
}

variable "memory_size" {
  description = "Lambda memory size in MB."
  type        = number
  default     = 128
}

variable "reserved_concurrent_executions" {
  description = "Reserved concurrency for the Lambda function. Leave null for unreserved."
  type        = number
  default     = null
  nullable    = true
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function."
  type        = map(string)
  default     = {}
}

variable "policies_json" {
  description = "Inline IAM policy JSON documents to attach to the Lambda execution role."
  type        = list(string)
  default     = []
}

variable "role_policy_arns" {
  description = "Managed IAM policy ARNs to attach to the Lambda execution role."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days. Leave null for CloudWatch's default retention."
  type        = number
  default     = 30
  nullable    = true
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
