variable "table_name" {
  description = "Name of the DynamoDB table"
  type        = string
}

variable "billing_mode" {
  description = "Billing mode for the table"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "hash_key" {
  description = "Partition key attribute name"
  type        = string
}

variable "range_key" {
  description = "Sort key attribute name (optional)"
  type        = string
  default     = null
}

variable "attributes" {
  description = "Attribute definitions for the table"
  type = list(object({
    name = string
    type = string
  }))
}

variable "ttl_enabled" {
  description = "Enable TTL on the table"
  type        = bool
  default     = false
}

variable "ttl_attribute_name" {
  description = "TTL attribute name"
  type        = string
  default     = "ttl"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}