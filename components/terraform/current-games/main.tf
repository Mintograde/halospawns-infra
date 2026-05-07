module "current_games_ddb" {
  source       = "../../../modules/ddb"
  table_name   = "current-games-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "game_id"
  attributes = [
    { name = "game_id", type = "S" }
  ]
  ttl_enabled        = true
  ttl_attribute_name = "ttl"
}

data "aws_iam_policy_document" "current_games_update_access" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [module.current_games_ddb.table_arn]
  }
}

data "aws_iam_policy_document" "current_games_list_access" {
  statement {
    actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"]
    resources = [module.current_games_ddb.table_arn]
  }
}

module "update_status_lambda" {
  source        = "../../../modules/lambda-zip"
  function_name = "update-status-${var.environment}"
  runtime       = "python3.12"
  handler       = "handler.handler"
  source_dir    = "../../../lambda/update_status"
  timeout       = 10
  memory_size   = 128
  environment_variables = {
    TABLE_NAME            = module.current_games_ddb.table_name
    RECENT_WINDOW_SECONDS = "600"
  }
  policies_json = [
    data.aws_iam_policy_document.current_games_update_access.json
  ]
}

module "list_games_lambda" {
  source        = "../../../modules/lambda-zip"
  function_name = "list-games-${var.environment}"
  runtime       = "python3.12"
  handler       = "handler.handler"
  source_dir    = "../../../lambda/list_games"
  timeout       = 10
  memory_size   = 128
  environment_variables = {
    TABLE_NAME            = module.current_games_ddb.table_name
    RECENT_WINDOW_SECONDS = "600"
  }
  policies_json = [
    data.aws_iam_policy_document.current_games_list_access.json
  ]
}

module "current_games_api" {
  source     = "../../../modules/api-gateway-rest"
  api_name   = "current-games"
  stage_name = var.environment

  routes = [
    {
      path             = "/game-status"
      method           = "POST"
      lambda_arn       = module.update_status_lambda.function_arn
      api_key_required = true
    },
    {
      path       = "/games"
      method     = "GET"
      lambda_arn = module.list_games_lambda.function_arn
    }
  ]

  usage_plan = {
    enabled        = true
    name           = "current-games-${var.environment}"
    throttle_burst = 50
    throttle_rate  = 100
    quota_limit    = 50000
    quota_period   = "MONTH"
  }
}
