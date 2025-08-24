variable "bucket_prefix" {
  description = "A unique prefix to be used for the S3 bucket name. The account ID will be appended to ensure global uniqueness."
  type        = string
}

variable "tags" {
  description = "A map of additional tags to apply to the S3 bucket."
  type        = map(string)
  default     = {}
}

variable "environment" {
  type = string
}