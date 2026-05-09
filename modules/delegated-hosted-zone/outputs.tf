output "zone_id" {
  description = "Route 53 hosted zone ID."
  value       = aws_route53_zone.this.zone_id
}

output "zone_name" {
  description = "Route 53 hosted zone name."
  value       = aws_route53_zone.this.name
}

output "name_servers" {
  description = "Authoritative name servers assigned to the hosted zone."
  value       = aws_route53_zone.this.name_servers
}

output "delegation_record_name" {
  description = "Parent-zone NS record name needed to delegate this zone."
  value       = aws_route53_zone.this.name
}

output "delegation_record_type" {
  description = "Parent-zone delegation record type."
  value       = "NS"
}

output "delegation_record_ttl" {
  description = "Recommended parent-zone delegation record TTL."
  value       = 300
}
