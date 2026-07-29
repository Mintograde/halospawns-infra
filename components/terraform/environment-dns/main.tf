data "aws_caller_identity" "current" {}

resource "terraform_data" "account_guard" {
  input = data.aws_caller_identity.current.account_id

  lifecycle {
    precondition {
      condition     = var.expected_account_id == null || data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "AWS profile resolved to account ${data.aws_caller_identity.current.account_id}; expected ${var.expected_account_id}."
    }
  }
}

module "delegated_zone" {
  for_each = var.zones

  source = "../../../modules/delegated-hosted-zone"

  zone_name     = each.value.name
  comment       = coalesce(each.value.comment, "Delegated public hosted zone for ${each.value.name} in ${var.environment}")
  force_destroy = each.value.force_destroy
  tags          = var.tags

  depends_on = [terraform_data.account_guard]
}
