locals {
  app_api_observability_enabled  = var.enabled && var.observability.enabled
  app_api_dashboard_name         = "${var.project}-${var.environment}-app-api"
  app_api_alert_topic_name       = "${var.project}-${var.environment}-app-api-alerts"
  app_api_lambda_log_group_name  = "/aws/lambda/${var.project}-${var.environment}-app-api"
  app_api_gateway_log_group_name = "/aws/apigateway/${var.project}-${var.environment}-app-api"

  app_api_log_queries = {
    route-performance = trimspace(<<-QUERY
      fields @message
      | filter @message like /"event":"request_completed"/
      | parse @message /"route":"(?<route>[^"]+)"/
      | parse @message /"status":(?<status>[0-9]+)/
      | parse @message /"duration_ms":(?<duration_ms>[0-9.]+)/
      | parse @message /"db_query_ms":(?<db_query_ms>[0-9.]+)/
      | stats count(*) as requests,
          avg(duration_ms) as avg_ms,
          pct(duration_ms, 95) as p95_ms,
          pct(duration_ms, 99) as p99_ms,
          max(duration_ms) as max_ms,
          avg(db_query_ms) as avg_db_ms
        by route
      | sort p95_ms desc
      | limit 50
    QUERY
    )

    slow-requests = trimspace(<<-QUERY
      fields @timestamp
      | filter @message like /"event":"request_completed"/
      | parse @message /"request_id":"(?<request_id>[^"]+)"/
      | parse @message /"trace_id":(?<trace_value>null|"[^"]+")/
      | parse @message /"route":"(?<route>[^"]+)"/
      | parse @message /"status":(?<status>[0-9]+)/
      | parse @message /"duration_ms":(?<duration_ms>[0-9.]+)/
      | parse @message /"db_query_ms":(?<db_query_ms>[0-9.]+)/
      | parse @message /"db_query_count":(?<db_query_count>[0-9]+)/
      | filter duration_ms >= 2000
      | sort duration_ms desc
      | display @timestamp, request_id, trace_value, route, status, duration_ms, db_query_ms, db_query_count
      | limit 100
    QUERY
    )

    database-hotspots = trimspace(<<-QUERY
      fields @message
      | filter @message like /"event":"request_completed"/
      | parse @message /"route":"(?<route>[^"]+)"/
      | parse @message /"db_query_ms":(?<db_query_ms>[0-9.]+)/
      | parse @message /"db_query_count":(?<db_query_count>[0-9]+)/
      | stats count(*) as requests,
          sum(db_query_count) as queries,
          avg(db_query_count) as avg_queries,
          pct(db_query_count, 95) as p95_queries,
          avg(db_query_ms) as avg_db_ms,
          pct(db_query_ms, 95) as p95_db_ms
        by route
      | sort p95_db_ms desc
      | limit 50
    QUERY
    )

    cold-versus-warm = trimspace(<<-QUERY
      fields @message
      | filter @message like /"event":"request_completed"/
      | parse @message /"cold_start":(?<cold_start>true|false)/
      | parse @message /"duration_ms":(?<duration_ms>[0-9.]+)/
      | parse @message /"db_connect_ms":(?<db_connect_ms>[0-9.]+)/
      | stats count(*) as requests,
          avg(duration_ms) as avg_ms,
          pct(duration_ms, 95) as p95_ms,
          avg(db_connect_ms) as avg_db_connect_ms
        by cold_start
    QUERY
    )

    recent-server-errors = trimspace(<<-QUERY
      fields @timestamp, @message
      | filter @message like /"event":"api_error"/
          or @message like /"event":"unhandled_exception"/
          or @message like /"outcome":"server_error"/
      | parse @message /"request_id":"(?<request_id>[^"]+)"/
      | parse @message /"trace_id":(?<trace_value>null|"[^"]+")/
      | parse @message /"route":"(?<route>[^"]+)"/
      | parse @message /"event":"(?<event>[^"]+)"/
      | parse @message /"error_type":"(?<error_type>[^"]+)"/
      | sort @timestamp desc
      | limit 100
    QUERY
    )
  }

  app_api_gateway_failure_query = trimspace(<<-QUERY
    fields @timestamp, requestId, routeKey, status, responseLatency,
      integrationStatus, integrationLatency, errorResponseType,
      integrationErrorMessage
    | filter status >= 400
    | sort @timestamp desc
    | limit 100
  QUERY
  )

  app_api_saved_log_queries = merge(
    {
      for name, query in local.app_api_log_queries : name => {
        log_group_name = local.app_api_lambda_log_group_name
        query_string   = query
      }
    },
    {
      gateway-failures = {
        log_group_name = local.app_api_gateway_log_group_name
        query_string   = local.app_api_gateway_failure_query
      }
    },
  )

  dashboard_upload_pipelines = try(data.terraform_remote_state.uploads_ingest[0].outputs.pipelines, {})
  dashboard_processing_queues = concat(
    [
      for name, pipeline in local.dashboard_upload_pipelines : {
        label      = "${title(name)} processing"
        queue_name = pipeline.queue_name
        dlq_name   = try(pipeline.dlq_name, element(split(":", pipeline.dlq_arn), 5))
      }
    ],
    local.map_rendering_queue_name == null || local.map_rendering_dlq_name == null ? [] : [
      {
        label      = "Map rendering"
        queue_name = local.map_rendering_queue_name
        dlq_name   = local.map_rendering_dlq_name
      }
    ],
  )

  dashboard_cloudfront_distributions = concat(
    try(data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_id, null) == null ? [] : [
      {
        label           = "Frontend"
        distribution_id = data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_id
      }
    ],
    try(data.terraform_remote_state.uploads_ingest[0].outputs.cloudfront_distribution_id, null) == null ? [] : [
      {
        label           = "Uploads CDN"
        distribution_id = data.terraform_remote_state.uploads_ingest[0].outputs.cloudfront_distribution_id
      }
    ],
  )

  app_api_alarm_names = {
    gateway_5xx                     = "${var.project}-${var.environment}-app-api-gateway-5xx"
    gateway_integration_latency_p95 = "${var.project}-${var.environment}-app-api-gateway-integration-latency-p95"
    lambda_duration_maximum         = "${var.project}-${var.environment}-app-api-lambda-duration-maximum"
    lambda_duration_p95             = "${var.project}-${var.environment}-app-api-lambda-duration-p95"
    lambda_errors                   = "${var.project}-${var.environment}-app-api-lambda-errors"
    lambda_throttles                = "${var.project}-${var.environment}-app-api-lambda-throttles"
  }
}

resource "aws_cloudwatch_query_definition" "app_api" {
  for_each = local.app_api_observability_enabled ? local.app_api_saved_log_queries : {}

  name            = "halospawns/app-api/${each.key}"
  log_group_names = [each.value.log_group_name]
  query_string    = each.value.query_string
}

resource "aws_sns_topic" "app_api_alerts" {
  count = local.app_api_observability_enabled ? 1 : 0

  name = local.app_api_alert_topic_name
  tags = var.tags
}

resource "aws_sns_topic_subscription" "app_api_alerts" {
  for_each = local.app_api_observability_enabled ? var.observability.alert_subscriptions : {}

  topic_arn = aws_sns_topic.app_api_alerts[0].arn
  protocol  = each.value.protocol
  endpoint  = each.value.endpoint
}

resource "aws_cloudwatch_metric_alarm" "gateway_5xx" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.gateway_5xx
  alarm_description   = "App API Gateway returned at least three 5xx responses in five minutes."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    ApiId = module.api[0].api_id
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.lambda_errors
  alarm_description   = "The app API Lambda reported an invocation error in five minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    FunctionName = module.app_lambda[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.lambda_throttles
  alarm_description   = "The app API Lambda was throttled in five minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    FunctionName = module.app_lambda[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration_p95" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.lambda_duration_p95
  alarm_description   = "The app API Lambda p95 duration was at least five seconds for two of three periods."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 5000
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    FunctionName = module.app_lambda[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration_maximum" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.lambda_duration_maximum
  alarm_description   = "The app API Lambda maximum duration was at least 25 seconds in five minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 25000
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    FunctionName = module.app_lambda[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "gateway_integration_latency_p95" {
  count = local.app_api_observability_enabled ? 1 : 0

  alarm_name          = local.app_api_alarm_names.gateway_integration_latency_p95
  alarm_description   = "App API Gateway p95 integration latency was at least three seconds for two of three periods."
  namespace           = "AWS/ApiGateway"
  metric_name         = "IntegrationLatency"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 3000
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.app_api_alerts[0].arn]
  ok_actions          = [aws_sns_topic.app_api_alerts[0].arn]
  tags                = var.tags

  dimensions = {
    ApiId = module.api[0].api_id
  }
}

resource "aws_cloudwatch_dashboard" "app_api" {
  count = local.app_api_observability_enabled ? 1 : 0

  dashboard_name = local.app_api_dashboard_name
  dashboard_body = jsonencode({
    start = "-PT24H"
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway requests and errors"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", module.api[0].api_id, { label = "Requests", stat = "Sum" }],
            ["AWS/ApiGateway", "4xx", "ApiId", module.api[0].api_id, { label = "4xx", stat = "Sum" }],
            ["AWS/ApiGateway", "5xx", "ApiId", module.api[0].api_id, { label = "5xx", stat = "Sum" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway latency"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { label = "Latency p50", stat = "p50" }],
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { label = "Latency p95", stat = "p95" }],
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { label = "Latency p99", stat = "p99" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { label = "Integration p50", stat = "p50" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { label = "Integration p95", stat = "p95" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { label = "Integration p99", stat = "p99" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "Lambda invocations and errors"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", module.app_lambda[0].function_name, { label = "Invocations", stat = "Sum" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.app_lambda[0].function_name, { label = "Errors", stat = "Sum" }],
            ["AWS/Lambda", "Throttles", "FunctionName", module.app_lambda[0].function_name, { label = "Throttles", stat = "Sum" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 10
        height = 6
        properties = {
          title   = "Lambda duration"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { label = "p50", stat = "p50" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { label = "p95", stat = "p95" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { label = "p99", stat = "p99" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { label = "Maximum", stat = "Maximum" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 6
        width  = 6
        height = 6
        properties = {
          title   = "Lambda concurrency"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.app_lambda[0].function_name, { label = "Maximum", stat = "Maximum" }],
          ]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 12
        height = 8
        properties = {
          title   = "Route performance"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_lambda_log_group_name}'\n| ${local.app_api_log_queries.route-performance}"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 12
        width  = 12
        height = 8
        properties = {
          title   = "Database hotspots"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_lambda_log_group_name}'\n| ${local.app_api_log_queries.database-hotspots}"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 20
        width  = 12
        height = 8
        properties = {
          title   = "Cold versus warm"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_lambda_log_group_name}'\n| ${local.app_api_log_queries.cold-versus-warm}"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 20
        width  = 12
        height = 8
        properties = {
          title   = "Recent server errors"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_lambda_log_group_name}'\n| ${local.app_api_log_queries.recent-server-errors}"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 28
        width  = 12
        height = 8
        properties = {
          title   = "Slow requests"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_lambda_log_group_name}'\n| ${local.app_api_log_queries.slow-requests}"
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 28
        width  = 12
        height = 8
        properties = {
          title   = "Recent API Gateway failures"
          view    = "table"
          region  = var.region
          stacked = false
          query   = "SOURCE '${local.app_api_gateway_log_group_name}'\n| ${local.app_api_gateway_failure_query}"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 36
        width  = 12
        height = 6
        properties = {
          title   = "Processing queue backlog"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = concat(
            [
              for queue in local.dashboard_processing_queues :
              ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", queue.queue_name, { label = "${queue.label} visible", stat = "Maximum" }]
            ],
            [
              for queue in local.dashboard_processing_queues :
              ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", queue.queue_name, { label = "${queue.label} in flight", stat = "Maximum" }]
            ],
          )
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 36
        width  = 12
        height = 6
        properties = {
          title   = "Oldest processing message"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            for queue in local.dashboard_processing_queues :
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", queue.queue_name, { label = queue.label, stat = "Maximum" }]
          ]
          yAxis = {
            left = {
              label = "Seconds"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 42
        width  = 24
        height = 6
        properties = {
          title     = "Processing dead-letter queues"
          view      = "singleValue"
          region    = var.region
          period    = 300
          sparkline = true
          metrics = [
            for queue in local.dashboard_processing_queues :
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", queue.dlq_name, { label = "${queue.label} DLQ", stat = "Maximum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 48
        width  = 12
        height = 6
        properties = {
          title   = "CloudFront traffic"
          view    = "timeSeries"
          region  = "us-east-1"
          period  = 300
          stacked = false
          metrics = concat(
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "Requests", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} requests", stat = "Sum" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "BytesDownloaded", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} downloaded", stat = "Sum", yAxis = "right" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "BytesUploaded", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} uploaded", stat = "Sum", yAxis = "right" }]
            ],
          )
          yAxis = {
            left = {
              label = "Requests"
              min   = 0
            }
            right = {
              label = "Bytes"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 48
        width  = 12
        height = 6
        properties = {
          title   = "CloudFront error rates"
          view    = "timeSeries"
          region  = "us-east-1"
          period  = 300
          stacked = false
          metrics = concat(
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "TotalErrorRate", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} total", stat = "Average" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "4xxErrorRate", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} 4xx", stat = "Average" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "5xxErrorRate", "DistributionId", distribution.distribution_id, "Region", "Global", { label = "${distribution.label} 5xx", stat = "Average" }]
            ],
          )
          yAxis = {
            left = {
              label = "Percent"
              min   = 0
              max   = 100
            }
          }
        }
      },
    ]
  })
}
