variable "zone_name" {
  description = "Public hosted zone name to create, such as dev.halospawns.com."
  type        = string

  validation {
    condition     = trimspace(var.zone_name) != ""
    error_message = "zone_name must not be empty."
  }
}

variable "comment" {
  description = "Hosted zone comment."
  type        = string
  default     = null
  nullable    = true
}

variable "force_destroy" {
  description = "Whether to destroy all records in the hosted zone when destroying the zone."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
