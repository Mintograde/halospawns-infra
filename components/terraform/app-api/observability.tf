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
      fields @timestamp
      | filter @message like /"event":"api_error"/
          or @message like /"event":"unhandled_exception"/
          or @message like /"outcome":"server_error"/
      | parse @message /"request_id":"(?<request_id>[^"]+)"/
      | parse @message /"trace_id":(?<trace_value>null|"[^"]+")/
      | parse @message /"route":"(?<route>[^"]+)"/
      | parse @message /"event":"(?<event>[^"]+)"/
      | parse @message /"error_type":"(?<error_type>[^"]+)"/
      | sort @timestamp desc
      | display @timestamp, request_id, trace_value, route, event, error_type
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

  dashboard_processing_palette = {
    maps = {
      primary   = "#2F80ED"
      secondary = "#56CCF2"
    }
    replays = {
      primary   = "#27AE60"
      secondary = "#6FCF97"
    }
    map-rendering = {
      primary   = "#F2994A"
      secondary = "#F2C94C"
    }
  }

  dashboard_upload_pipelines = try(data.terraform_remote_state.uploads_ingest[0].outputs.pipelines, {})
  dashboard_processing_queues = concat(
    [
      for name, pipeline in local.dashboard_upload_pipelines : {
        key                         = name
        label                       = "${title(name)} processing"
        short_label                 = title(name)
        queue_name                  = pipeline.queue_name
        dlq_name                    = try(pipeline.dlq_name, element(split(":", pipeline.dlq_arn), 5))
        queue_age_threshold_seconds = try(pipeline.queue_age_threshold_seconds, name == "maps" ? 900 : 300)
        primary_color               = local.dashboard_processing_palette[name].primary
        secondary_color             = local.dashboard_processing_palette[name].secondary
      }
    ],
    local.map_rendering_queue_name == null || local.map_rendering_dlq_name == null ? [] : [
      {
        key                         = "map-rendering"
        label                       = "Map rendering"
        short_label                 = "Rendering"
        queue_name                  = local.map_rendering_queue_name
        dlq_name                    = local.map_rendering_dlq_name
        queue_age_threshold_seconds = var.dependencies.queues.map_rendering_age_threshold_seconds
        primary_color               = local.dashboard_processing_palette["map-rendering"].primary
        secondary_color             = local.dashboard_processing_palette["map-rendering"].secondary
      }
    ],
  )

  dashboard_queue_age_threshold_labels = {
    for queue in local.dashboard_processing_queues :
    tostring(queue.queue_age_threshold_seconds) => queue.short_label...
  }

  dashboard_cloudfront_distributions = concat(
    try(data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_id, null) == null ? [] : [
      {
        label           = "Frontend"
        distribution_id = data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_id
        primary_color   = "#2F80ED"
        secondary_color = "#56CCF2"
        tertiary_color  = "#9B51E0"
        error_4xx_color = "#F2C94C"
        error_5xx_color = "#EB5757"
      }
    ],
    try(data.terraform_remote_state.uploads_ingest[0].outputs.cloudfront_distribution_id, null) == null ? [] : [
      {
        label           = "Uploads CDN"
        distribution_id = data.terraform_remote_state.uploads_ingest[0].outputs.cloudfront_distribution_id
        primary_color   = "#27AE60"
        secondary_color = "#6FCF97"
        tertiary_color  = "#219653"
        error_4xx_color = "#F2994A"
        error_5xx_color = "#B83280"
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

  dashboard_upload_alarm_names = flatten([
    for alarm_group in values(try(data.terraform_remote_state.uploads_ingest[0].outputs.processing_queue_alarm_names, {})) :
    values(alarm_group)
  ])
  dashboard_alarm_names = sort(distinct(concat(
    values(local.app_api_alarm_names),
    local.dashboard_upload_alarm_names,
    tolist(var.observability.additional_alarm_names),
  )))
  dashboard_alarm_arns = [
    for alarm_name in local.dashboard_alarm_names :
    "arn:${data.aws_partition.current.partition}:cloudwatch:${var.region}:${data.aws_caller_identity.current.account_id}:alarm:${alarm_name}"
  ]
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
    start          = "-PT6H"
    periodOverride = "inherit"
    widgets = [
      {
        type   = "alarm"
        x      = 0
        y      = 0
        width  = 18
        height = 4
        properties = {
          title  = "Active alarms"
          alarms = local.dashboard_alarm_arns
          states = [
            "ALARM",
            "INSUFFICIENT_DATA",
          ]
          sortBy = "stateUpdatedTimestamp"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 4
        width  = 24
        height = 1
        properties = {
          markdown = "### API and Lambda"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 17
        width  = 24
        height = 1
        properties = {
          markdown = "### Processing"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 24
        width  = 24
        height = 1
        properties = {
          markdown = "### Edge delivery"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 31
        width  = 24
        height = 1
        properties = {
          markdown = "### Diagnostics"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 5
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway requests and errors"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", module.api[0].api_id, { color = "#2F80ED", label = "Requests", stat = "Sum" }],
            ["AWS/ApiGateway", "4xx", "ApiId", module.api[0].api_id, { color = "#F2C94C", label = "4xx", stat = "Sum", yAxis = "right" }],
            ["AWS/ApiGateway", "5xx", "ApiId", module.api[0].api_id, { color = "#EB5757", label = "5xx", stat = "Sum", yAxis = "right" }],
          ]
          annotations = {
            horizontal = [
              {
                color = "#EB5757"
                label = "5xx alarm (3)"
                value = 3
                yAxis = "right"
              },
            ]
          }
          yAxis = {
            left = {
              label = "Requests"
              min   = 0
            }
            right = {
              label = "Errors"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 5
        width  = 12
        height = 6
        properties = {
          title   = "API Gateway latency"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { color = "#2F80ED", label = "Latency p50", stat = "p50" }],
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { color = "#F2994A", label = "Latency p95", stat = "p95" }],
            ["AWS/ApiGateway", "Latency", "ApiId", module.api[0].api_id, { color = "#EB5757", label = "Latency p99", stat = "p99" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { color = "#56CCF2", label = "Integration p50", stat = "p50" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { color = "#27AE60", label = "Integration p95", stat = "p95" }],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", module.api[0].api_id, { color = "#9B51E0", label = "Integration p99", stat = "p99" }],
          ]
          annotations = {
            horizontal = [
              {
                color = "#EB5757"
                label = "Integration p95 alarm (3s)"
                value = 3000
              },
            ]
          }
          yAxis = {
            left = {
              label = "Milliseconds"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 11
        width  = 8
        height = 6
        properties = {
          title   = "Lambda invocations and errors"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", module.app_lambda[0].function_name, { color = "#2F80ED", label = "Invocations", stat = "Sum" }],
            ["AWS/Lambda", "Errors", "FunctionName", module.app_lambda[0].function_name, { color = "#EB5757", label = "Errors", stat = "Sum", yAxis = "right" }],
            ["AWS/Lambda", "Throttles", "FunctionName", module.app_lambda[0].function_name, { color = "#F2994A", label = "Throttles", stat = "Sum", yAxis = "right" }],
          ]
          annotations = {
            horizontal = [
              {
                color = "#EB5757"
                label = "Error/throttle alarm (1)"
                value = 1
                yAxis = "right"
              },
            ]
          }
          yAxis = {
            left = {
              label = "Invocations"
              min   = 0
            }
            right = {
              label = "Errors"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 11
        width  = 10
        height = 6
        properties = {
          title   = "Lambda duration"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { color = "#2F80ED", label = "p50", stat = "p50" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { color = "#F2994A", label = "p95", stat = "p95" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { color = "#EB5757", label = "p99", stat = "p99" }],
            ["AWS/Lambda", "Duration", "FunctionName", module.app_lambda[0].function_name, { color = "#9B51E0", label = "Maximum", stat = "Maximum" }],
          ]
          annotations = {
            horizontal = [
              {
                color = "#EB5757"
                label = "p95 alarm (5s)"
                value = 5000
              },
            ]
          }
          yAxis = {
            left = {
              label = "Milliseconds"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 11
        width  = 6
        height = 6
        properties = {
          title   = "Lambda concurrency"
          view    = "timeSeries"
          region  = var.region
          period  = 300
          stacked = false
          metrics = [
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", module.app_lambda[0].function_name, { color = "#27AE60", label = "Maximum", stat = "Maximum" }],
          ]
          yAxis = {
            left = {
              label = "Executions"
              min   = 0
            }
          }
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 39
        width  = 12
        height = 7
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
        y      = 39
        width  = 12
        height = 7
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
        x      = 14
        y      = 46
        width  = 10
        height = 5
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
        x      = 0
        y      = 32
        width  = 12
        height = 7
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
        y      = 46
        width  = 14
        height = 7
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
        y      = 32
        width  = 12
        height = 7
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
        y      = 18
        width  = 12
        height = 6
        properties = {
          title   = "Processing queue backlog"
          view    = "timeSeries"
          region  = var.region
          period  = 60
          stacked = false
          metrics = concat(
            [
              for queue in local.dashboard_processing_queues :
              ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", queue.queue_name, { color = queue.primary_color, label = "${queue.short_label} visible", stat = "Maximum" }]
            ],
            [
              for queue in local.dashboard_processing_queues :
              ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", queue.queue_name, { color = queue.secondary_color, label = "${queue.short_label} in flight", stat = "Maximum" }]
            ],
          )
          yAxis = {
            left = {
              label = "Messages"
              min   = 0
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6
        properties = {
          title   = "Oldest processing message"
          view    = "timeSeries"
          region  = var.region
          period  = 60
          stacked = false
          metrics = [
            for queue in local.dashboard_processing_queues :
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", queue.queue_name, { color = queue.primary_color, label = queue.short_label, stat = "Maximum" }]
          ]
          annotations = {
            horizontal = [
              for threshold, labels in local.dashboard_queue_age_threshold_labels : {
                color = threshold == "300" ? "#EB5757" : "#F2994A"
                label = "${join("/", labels)} alarm (${threshold}s)"
                value = tonumber(threshold)
              }
            ]
          }
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
        x      = 18
        y      = 0
        width  = 6
        height = 4
        properties = {
          title     = "Processing dead-letter queues"
          view      = "singleValue"
          region    = var.region
          period    = 60
          sparkline = true
          metrics = [
            for queue in local.dashboard_processing_queues :
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", queue.dlq_name, { color = queue.primary_color, label = "${queue.short_label} DLQ", stat = "Maximum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 25
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
              ["AWS/CloudFront", "Requests", "DistributionId", distribution.distribution_id, "Region", "Global", { color = distribution.primary_color, label = "${distribution.label} requests", stat = "Sum" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "BytesDownloaded", "DistributionId", distribution.distribution_id, "Region", "Global", { color = distribution.secondary_color, label = "${distribution.label} downloaded", stat = "Sum", yAxis = "right" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "BytesUploaded", "DistributionId", distribution.distribution_id, "Region", "Global", { color = distribution.tertiary_color, label = "${distribution.label} uploaded", stat = "Sum", yAxis = "right" }]
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
        y      = 25
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
              ["AWS/CloudFront", "4xxErrorRate", "DistributionId", distribution.distribution_id, "Region", "Global", { color = distribution.error_4xx_color, label = "${distribution.label} 4xx", stat = "Average" }]
            ],
            [
              for distribution in local.dashboard_cloudfront_distributions :
              ["AWS/CloudFront", "5xxErrorRate", "DistributionId", distribution.distribution_id, "Region", "Global", { color = distribution.error_5xx_color, label = "${distribution.label} 5xx", stat = "Average" }]
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
