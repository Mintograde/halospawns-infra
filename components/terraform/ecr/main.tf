resource "aws_ecr_repository" "lambda_container" {
  for_each             = toset(local.lambda_containers)
  name                 = each.key
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "lambda_container" {
  for_each   = toset(local.lambda_containers)
  repository = aws_ecr_repository.lambda_container[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images older than 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
