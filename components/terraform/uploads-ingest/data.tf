data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "terraform_remote_state" "environment_dns" {
  count = (
    var.dependencies.state_bucket != null &&
    var.dependencies.state_keys.environment_dns != null &&
    var.cdn.hosted_zone_key != null
  ) ? 1 : 0

  backend = "s3"
  config = {
    bucket  = var.dependencies.state_bucket
    key     = var.dependencies.state_keys.environment_dns
    region  = var.region
    profile = var.profile
  }
}
