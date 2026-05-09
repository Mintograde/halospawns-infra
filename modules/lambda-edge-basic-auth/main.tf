resource "aws_ssm_parameter" "credential" {
  count = var.create_ssm_parameter ? 1 : 0

  name        = var.ssm_parameter_name
  description = "Base64 Basic Auth credential for ${var.project}-${var.environment} frontend site."
  type        = "SecureString"
  value       = var.ssm_placeholder_value
  key_id      = var.ssm_kms_key_id
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_iam_role" "edge" {
  name               = "${var.function_name}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.edge.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "ssm_access" {
  name   = "basic-auth-credential-access"
  role   = aws_iam_role.edge.id
  policy = data.aws_iam_policy_document.ssm_access.json
}

resource "terraform_data" "lambda_package" {
  triggers_replace = {
    index_js_sha256     = sha256(local.auth_index_js)
    dependencies_json   = jsonencode(local.package_dependencies)
    build_script_sha256 = filesha256("${path.module}/build-package.mjs")
  }

  provisioner "local-exec" {
    command     = "node build-package.mjs"
    working_dir = path.module

    environment = {
      LAMBDA_EDGE_AUTH_BUILD_DIR    = local.package_build_dir
      LAMBDA_EDGE_AUTH_INDEX_JS_B64 = base64encode(local.auth_index_js)
      LAMBDA_EDGE_AUTH_DEPENDENCIES = jsonencode(local.package_dependencies)
    }
  }
}

data "archive_file" "lambda" {
  depends_on = [terraform_data.lambda_package]

  type        = "zip"
  source_dir  = local.package_build_dir
  output_path = local.package_output_path
}

resource "aws_lambda_function" "edge" {
  function_name    = var.function_name
  role             = aws_iam_role.edge.arn
  runtime          = var.runtime
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  publish          = true
  timeout          = var.timeout
  memory_size      = var.memory_size
  architectures    = ["x86_64"]
  tags             = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.ssm_access
  ]
}
