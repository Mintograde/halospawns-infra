variable "region" {
  description = "Region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "halospawns"
}

variable "profile" {
  description = "Profile name"
  type        = string
  default     = null
}

variable "allowed_cors_origins" {
  description = "Origins allowed to upload directly to the S3 bucket with browser CORS."
  type        = list(string)
  default     = ["halospawns.com", "halospawns.benzeis.com", "localhost:8080"]
}
