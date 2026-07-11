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

variable "repositories" {
  description = "ECR repositories keyed by stable repository name."
  type = map(object({
    image_tag_mutability       = optional(string, "MUTABLE")
    force_delete               = optional(bool, false)
    untagged_image_expiry_days = optional(number, 7)
  }))
  default = {}

  validation {
    condition = alltrue([
      for repository in values(var.repositories) :
      contains(["MUTABLE", "IMMUTABLE"], repository.image_tag_mutability) &&
      repository.untagged_image_expiry_days > 0
    ])
    error_message = "Repository mutability must be MUTABLE or IMMUTABLE and expiry days must be positive."
  }
}
