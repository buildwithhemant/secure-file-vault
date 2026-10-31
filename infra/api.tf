resource "aws_apigatewayv2_api" "main" {
  name          = local.name
  protocol_type = "HTTP"
  description   = "Secure file vault API"

  cors_configuration {
    allow_origins = var.cors_allowed_origins
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

# API Gateway validates the Cognito JWT (signature, expiry, audience, issuer)
# before the Lambda is invoked. Unauthenticated requests never reach code.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.cli.id]
    issuer   = "https://${aws_cognito_user_pool.main.endpoint}"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "api" {
  for_each = toset(local.routes)

  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      latencyMs      = "$context.responseLatency"
      sub            = "$context.authorizer.claims.sub"
      errorMessage   = "$context.error.message"
    })
  }
}

resource "aws_lambda_permission" "apigw_invoke_api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
