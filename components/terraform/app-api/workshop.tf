variable "workshop_maps_enabled" {
  type    = bool
  default = false
}
locals {
  workshop_api_environment = var.workshop_maps_enabled ? {
    WORKSHOP_MAPS_ENABLED    = "true"
    WORKSHOP_FILMS_TOPIC_ARN = data.terraform_remote_state.uploads_ingest[0].outputs.file_uploaded_topic_arns["films"]
  } : {}
  workshop_api_routes = var.workshop_maps_enabled ? [
    for action in ["observe", "claim", "complete", "maintain"] : {
      route_key = "POST /v1/ingest/workshop/${action}", authorization_type = "NONE"
    }
  ] : []
}
