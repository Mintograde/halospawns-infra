locals {
  api_settings = var.settings.api == null ? null : {
    for name, value in {
      db_schema            = var.settings.api.db_schema
      db_extra_search_path = var.settings.api.db_extra_search_path
      max_rows             = var.settings.api.max_rows
      db_pool              = var.settings.api.db_pool
    } : name => value if value != null
  }

  auth_settings = var.settings.auth == null ? null : {
    for name, value in {
      site_url                         = var.settings.auth.site_url
      uri_allow_list                   = var.settings.auth.uri_allow_list
      disable_signup                   = var.settings.auth.disable_signup
      external_anonymous_users_enabled = var.settings.auth.external_anonymous_users_enabled
      jwt_exp                          = var.settings.auth.jwt_exp
      mailer_autoconfirm               = var.settings.auth.mailer_autoconfirm
    } : name => value if value != null
  }

  network_settings = var.settings.network_restrictions == null ? null : {
    restrictions = var.settings.network_restrictions
  }

  managed_categories = compact([
    local.api_settings == null ? "" : (length(local.api_settings) > 0 ? "api" : ""),
    local.auth_settings == null ? "" : (length(local.auth_settings) > 0 ? "auth" : ""),
    local.network_settings == null ? "" : "network",
  ])
}

resource "supabase_settings" "this" {
  count = var.enabled ? 1 : 0

  project_ref = var.project_ref
  api         = local.api_settings == null ? null : jsonencode(local.api_settings)
  auth        = local.auth_settings == null ? null : jsonencode(local.auth_settings)
  network     = local.network_settings == null ? null : jsonencode(local.network_settings)

  lifecycle {
    precondition {
      condition     = length(local.managed_categories) > 0
      error_message = "At least one non-empty Supabase settings category must be configured when enabled is true."
    }
  }
}
