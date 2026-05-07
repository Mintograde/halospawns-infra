data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.ecr_state_key
    region  = var.region
    profile = var.profile
  }
}

data "terraform_remote_state" "uploads_ingest" {
  backend = "s3"
  config = {
    bucket  = var.tfstate_bucket
    key     = var.uploads_ingest_state_key
    region  = var.region
    profile = var.profile
  }
}
