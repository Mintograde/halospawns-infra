output "zones" {
  description = "Delegated public hosted-zone contracts keyed by stable logical name."
  value = {
    for key, zone in module.delegated_zone : key => {
      zone_id                = zone.zone_id
      zone_name              = zone.zone_name
      name_servers           = zone.name_servers
      delegation_record_name = zone.delegation_record_name
      delegation_record_type = zone.delegation_record_type
      delegation_record_ttl  = zone.delegation_record_ttl
    }
  }
}
