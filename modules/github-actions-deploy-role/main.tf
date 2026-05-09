resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprint_list

  tags = var.tags
}

resource "aws_iam_role" "deploy" {
  name                 = local.role_name
  assume_role_policy   = data.aws_iam_policy_document.assume_role.json
  max_session_duration = 3600
  tags                 = var.tags

  lifecycle {
    precondition {
      condition     = var.create_github_oidc_provider || var.github_oidc_provider_arn != null
      error_message = "github_oidc_provider_arn is required when create_github_oidc_provider is false."
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "frontend-site-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
