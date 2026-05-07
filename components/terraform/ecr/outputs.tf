output "repository_urls" {
  description = "ECR repository URLs by repository name."
  value = {
    for name, repository in aws_ecr_repository.lambda_container :
    name => repository.repository_url
  }
}
