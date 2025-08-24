locals {
  file_upload_types = [
    "maps",
    "replays"
  ]

  full_domain_name = "api-${var.environment}.halospawns.com"
}

locals {
  lambda_containers = [
    "halospawns-tools"
  ]
}

locals {
  lambda_configurations = {
    "halospawns-tools" = {
      description    = "Processes halo map files from SQS"
      sqs_queue_arn  = aws_sqs_queue.file_processing["maps"].arn
      s3_bucket_arn  = module.uploads_bucket.s3_bucket_arn
      s3_bucket_path = "/maps"
    }
  }
}
