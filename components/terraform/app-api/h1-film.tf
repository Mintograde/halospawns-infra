variable "h1_film" {
  description = "Dedicated H1 contracts. Upload/processing activation requires measured bounds and coordinated readiness."
  type = object({
    enabled            = optional(bool, false)
    processing_enabled = optional(bool, false)
    uploads_enabled    = optional(bool, false)
    max_size_bytes     = optional(number)
    max_source_ticks   = optional(number)
    max_players        = optional(number)
  })
  default = {}

  validation {
    condition = (!var.h1_film.uploads_enabled || var.h1_film.processing_enabled) && (
      !var.h1_film.processing_enabled || (var.h1_film.enabled && try(
        var.h1_film.max_size_bytes > 0 && var.h1_film.max_size_bytes <= 536870912 &&
        var.h1_film.max_source_ticks > 0 && var.h1_film.max_source_ticks <= 432000 &&
        var.h1_film.max_players > 0 && var.h1_film.max_players <= 4 &&
        floor(var.h1_film.max_size_bytes) == var.h1_film.max_size_bytes &&
        floor(var.h1_film.max_source_ticks) == var.h1_film.max_source_ticks &&
        floor(var.h1_film.max_players) == var.h1_film.max_players,
        false,
      ))
    )
    error_message = "H1 activation requires the dedicated contracts and explicit measured integer bounds. Uploads require processing."
  }
}

locals {
  h1_film_api_enabled = var.enabled && var.h1_film.enabled
  h1_film_pipeline    = try(data.terraform_remote_state.uploads_ingest[0].outputs.pipelines.films, null)
  h1_film_api_environment = local.h1_film_api_enabled ? merge({
    H1FILM_UPLOADS_ENABLED      = tostring(var.h1_film.uploads_enabled)
    H1FILM_PROCESSING_ENABLED   = tostring(var.h1_film.processing_enabled)
    H1FILM_PROCESSING_QUEUE_URL = try(local.h1_film_pipeline.queue_url, "")
    }, var.h1_film.processing_enabled ? {
    H1FILM_MAX_SIZE_BYTES   = tostring(var.h1_film.max_size_bytes)
    H1FILM_MAX_SOURCE_TICKS = tostring(var.h1_film.max_source_ticks)
    H1FILM_MAX_PLAYERS      = tostring(var.h1_film.max_players)
  } : {}) : {}
  h1_film_api_routes = local.h1_film_api_enabled ? [
    { route_key = "POST /v1/ingest/h1films/prepare", authorization_type = "NONE" },
    { route_key = "POST /v1/ingest/h1films/resolve-map", authorization_type = "NONE" },
  ] : []
}

resource "terraform_data" "h1_film_contract" {
  count = local.h1_film_api_enabled ? 1 : 0
  input = local.h1_film_api_environment

  lifecycle {
    precondition {
      condition     = var.environment == "dev" && data.aws_caller_identity.current.account_id == "283279960672"
      error_message = "H1 adoption is authorized in dev only."
    }
    precondition {
      condition = try(
        local.h1_film_pipeline.unprocessed_prefix == "films/unprocessed/" &&
        local.h1_film_pipeline.queue_url != "" &&
        local.trusted_service_hmac_parameter_names["h1-film"] != "",
        false,
      )
      error_message = "Apply the dedicated films pipeline and register the external h1-film HMAC parameter first."
    }
  }
}
