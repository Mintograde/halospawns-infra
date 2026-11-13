variable "workshop_ci_enabled" {
  type    = bool
  default = false
}

data "aws_caller_identity" "workshop" {}

resource "aws_iam_role" "workshop_ci" {
  count = var.workshop_ci_enabled ? 1 : 0
  name  = "${var.project}-${var.environment}-workshop-publish"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "arn:aws:iam::${data.aws_caller_identity.workshop.account_id}:oidc-provider/token.actions.githubusercontent.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:Mintograde/halospawns-infra:ref:refs/heads/master"
      } }
    }]
  })
  lifecycle {
    precondition {
      condition     = var.environment == "dev" && data.aws_caller_identity.workshop.account_id == "283279960672"
      error_message = "Workshop publishing is only authorized for dev."
    }
  }
}

resource "aws_iam_role_policy" "workshop_ci" {
  count = var.workshop_ci_enabled ? 1 : 0
  role  = aws_iam_role.workshop_ci[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"],
        Resource = [aws_ecr_repository.lambda_container["halospawns-workshop-maps"].arn,
      aws_ecr_repository.lambda_container["halospawns-h1-film"].arn] }
    ]
  })
}
