variable "movement_flow_enabled" {
  type        = bool
  default     = false
  description = "Enable the movement worker callback and signed delivery of immutable movement fields."
}

locals {
  movement_flow_api_routes = var.movement_flow_enabled ? [{
    route_key          = "POST /v1/ingest/movement-flow"
    authorization_type = "NONE" # The API authenticates the heatmap worker's HMAC.
  }] : []
}
