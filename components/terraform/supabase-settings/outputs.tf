output "project_ref" {
  description = "Supabase project reference targeted by this component when enabled."
  value       = var.enabled ? var.project_ref : null
}

output "managed_categories" {
  description = "Supabase settings categories managed by this component when enabled."
  value       = var.enabled ? local.managed_categories : null
}

output "settings_resource_id" {
  description = "Supabase settings resource ID when management is enabled."
  value       = try(supabase_settings.this[0].id, null)
}
