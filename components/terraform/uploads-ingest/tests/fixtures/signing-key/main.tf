variable "environment" { type = string }
variable "storage" { type = any }

# Simulate an externally seeded non-secret public key in the shared mock state.
resource "aws_ssm_parameter" "upload_signing_public_key" {
  name  = "/halospawns/dev/cloudfront/upload-signing/public-key"
  type  = "String"
  value = "-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----"
}
