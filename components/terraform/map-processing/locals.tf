locals {
  lambda_containers = [
    "halospawns-tools"
  ]

  lambda_configurations = {
    "halospawns-tools" = {
      description    = "Processes halo map files from SQS"
      sqs_queue_arn  = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["maps"]
      s3_bucket_arn  = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path = "/maps"
    }
  }
}
