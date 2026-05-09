resource "aws_route53_zone" "this" {
  name          = var.zone_name
  comment       = coalesce(var.comment, "Delegated public hosted zone for ${var.zone_name}")
  force_destroy = var.force_destroy
  tags          = var.tags
}
