variable "function_name" {
  description = "Code updater Lambda function name."
  type        = string
}

variable "role_name" {
  description = "Code updater execution role name."
  type        = string
}

variable "policy_name" {
  description = "Inline IAM policy name."
  type        = string
}

variable "permission_statement_id" {
  description = "Statement ID for the artifact-bucket Lambda permission."
  type        = string
}

variable "source_dir" {
  description = "Directory containing the code updater Lambda source."
  type        = string
}

variable "output_path" {
  description = "Generated updater ZIP output path."
  type        = string
}

variable "artifact_bucket_arn" {
  description = "ARN of the release artifact bucket."
  type        = string
}

variable "artifact_release_prefix" {
  description = "Normalized S3 release artifact prefix."
  type        = string
}

variable "target_function_name" {
  description = "Lambda function whose code the updater publishes."
  type        = string
}

variable "target_function_arn" {
  description = "ARN of the Lambda function whose code the updater publishes."
  type        = string
}

variable "target_alias_name" {
  description = "Alias advanced after publishing a function version."
  type        = string
}

variable "target_alias_arn" {
  description = "ARN of the alias advanced after publishing a function version."
  type        = string
}

variable "update_code_statement_sid" {
  description = "SID for the IAM statement allowing target function updates."
  type        = string
  default     = "UpdateTargetLambdaCode"
}

variable "reserved_concurrent_executions" {
  description = "Optional reserved concurrency for the updater Lambda."
  type        = number
  default     = null
  nullable    = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags to apply to updater resources."
  type        = map(string)
  default     = {}
}
