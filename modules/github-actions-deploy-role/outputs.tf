output "role_name" {
  description = "Name of the GitHub Actions deploy role."
  value       = aws_iam_role.deploy.name
}

output "role_arn" {
  description = "ARN of the GitHub Actions deploy role."
  value       = aws_iam_role.deploy.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider used by the role."
  value       = local.github_oidc_provider_arn
}

output "github_subject" {
  description = "GitHub OIDC subject allowed to assume the role."
  value       = local.github_subject
}
