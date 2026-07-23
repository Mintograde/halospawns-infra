locals {
  processing_queue_alarm_names = {
    for name in keys(local.pipelines) : name => {
      queue_age = "${var.project}-${var.environment}-${name}-processing-queue-age"
      dlq_depth = "${var.project}-${var.environment}-${name}-processing-dlq-depth"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "processing_queue_age" {
  for_each = var.observability.enabled ? local.pipelines : {}

  alarm_name          = local.processing_queue_alarm_names[each.key].queue_age
  alarm_description   = "The oldest visible ${each.key} processing message has exceeded its expected processing window."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = lookup(var.observability.queue_age_threshold_seconds, each.key, each.value.visibility_timeout_seconds)
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.file_processing[each.key].name
  }
}

resource "aws_cloudwatch_metric_alarm" "processing_dlq_depth" {
  for_each = var.observability.enabled ? local.pipelines : {}

  alarm_name          = local.processing_queue_alarm_names[each.key].dlq_depth
  alarm_description   = "The ${each.key} processing dead-letter queue contains a failed message."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.file_dlq[each.key].name
  }
}
