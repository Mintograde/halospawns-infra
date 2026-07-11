resource "aws_ecr_repository" "lambda_container" {
  for_each             = var.repositories
  name                 = each.key
  image_tag_mutability = each.value.image_tag_mutability
  force_delete         = each.value.force_delete
}

resource "aws_ecr_lifecycle_policy" "lambda_container" {
  for_each   = var.repositories
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
          countNumber = each.value.untagged_image_expiry_days
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
