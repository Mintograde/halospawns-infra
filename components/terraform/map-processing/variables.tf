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

variable "tfstate_bucket" {
  description = "S3 bucket containing component Terraform states."
  type        = string
}

variable "ecr_state_key" {
  description = "S3 state key for the ecr component."
  type        = string
}

variable "uploads_ingest_state_key" {
  description = "S3 state key for the uploads-ingest component."
  type        = string
}
