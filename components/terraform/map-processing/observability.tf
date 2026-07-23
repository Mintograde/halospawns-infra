locals {
  map_rendering_alarm_names = {
    queue_age = "${var.project}-${var.environment}-map-rendering-queue-age"
    dlq_depth = "${var.project}-${var.environment}-map-rendering-dlq-depth"
  }
}

resource "aws_cloudwatch_metric_alarm" "map_rendering_queue_age" {
  count = var.renderer.alarms.enabled ? 1 : 0

  alarm_name          = local.map_rendering_alarm_names.queue_age
  alarm_description   = "The oldest visible map rendering message has exceeded its expected processing window."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = var.renderer.alarms.queue_age_threshold_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.map_rendering.name
  }
}

resource "aws_cloudwatch_metric_alarm" "map_rendering_dlq_depth" {
  count = var.renderer.alarms.enabled ? 1 : 0

  alarm_name          = local.map_rendering_alarm_names.dlq_depth
  alarm_description   = "The map rendering dead-letter queue contains a failed message."
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
    QueueName = aws_sqs_queue.map_rendering_dlq.name
  }
}
