locals {
  file_upload_types = [
    "maps",
    "replays"
  ]

  full_domain_name = "api-${var.environment}.halospawns.com"

  upload_signing_private_key_secret_name   = "/${var.project}/${var.environment}/cloudfront/upload-signing/private-key"
  upload_signing_public_key_parameter_name = "/${var.project}/${var.environment}/cloudfront/upload-signing/public-key"
}
