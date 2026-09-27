locals {
  app_configuration = {
    Environment   = { Variables = local.app_lambda_environment }
    Runtime       = var.release.lambda.runtime
    Handler       = var.release.lambda.handler
    MemorySize    = var.release.lambda.memory_mb
    Timeout       = var.release.lambda.timeout_seconds
    TracingConfig = { Mode = var.observability.enabled ? "Active" : "PassThrough" }
  }
  app_configuration_hash = sha256(jsonencode(local.app_configuration))
}

resource "aws_lambda_invocation" "configuration" {
  count = var.enabled && var.release.promote_configuration ? 1 : 0

  function_name   = module.code_updater[0].function_name
  lifecycle_scope = "CREATE_ONLY"
  input = jsonencode({
    operation          = "promote_configuration"
    configuration_json = jsonencode(local.app_configuration)
    configuration_hash = local.app_configuration_hash
  })

  # Application releases must not invalidate a configuration promotion request.
  triggers = { configuration = local.app_configuration_hash }

  lifecycle {
    postcondition {
      condition = try(
        contains(["promoted", "already_current"], jsondecode(self.result).status) &&
        jsondecode(self.result).configuration_hash == local.app_configuration_hash,
        false,
      )
      error_message = "The updater did not confirm the requested configuration on live. Inspect its logs and retry the apply."
    }
  }

  depends_on = [module.app_lambda, module.code_updater]
}
