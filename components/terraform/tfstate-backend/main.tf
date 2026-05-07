module "backend" {
  source        = "../../../modules/backend"
  bucket_prefix = "${var.project}-tfstate"
  tags          = { "Description" = "Stores Terraform remote state" }
  environment   = var.environment
}
