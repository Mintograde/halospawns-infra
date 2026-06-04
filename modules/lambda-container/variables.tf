variable "function_name" {
  description = "Name for the Lambda function."
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN of the SQS queue that triggers the Lambda."
  type        = string
}

variable "image_uri" {
  description = "URI of the container image in ECR (e.g., account.dkr.ecr.region.amazonaws.com/repo:tag)."
  type        = string
}

variable "timeout" {
  description = "Lambda function timeout in seconds."
  type        = number
  default     = 300 # 5 minutes
}

variable "memory_size" {
  description = "Lambda function memory size in MB."
  type        = number
  default     = 512
}

variable "ephemeral_storage_size" {
  description = "Optional Lambda ephemeral storage size in MB."
  type        = number
  default     = null
  nullable    = true
}

variable "batch_size" {
  description = "The maximum number of items to retrieve in a single batch from the SQS queue."
  type        = number
  default     = 10
}

variable "report_batch_item_failures" {
  description = "Whether the SQS event source mapping should enable partial batch failure responses."
  type        = bool
  default     = false
}

variable "event_source_enabled" {
  description = "Whether the SQS event source mapping is enabled."
  type        = bool
  default     = true
}

variable "environment_variables" {
  description = "A map of environment variables for the Lambda function."
  type        = map(string)
  default     = {}
}

variable "additional_iam_policies" {
  description = "A map of IAM policy documents to attach to the Lambda's execution role. Key is the policy name, value is the JSON policy."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "A map of tags to assign to the resources."
  type        = map(string)
  default     = {}
}

variable "s3_bucket_arn" {
  description = "Lambda will be given read/write access to this bucket"
  type        = string
  default     = ""
}

variable "s3_bucket_path" {
  description = "Lambda will be given read/write access to this path within the bucket, with leading slash and no trailing slash"
  type        = string
  default     = ""
}
