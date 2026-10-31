output "api_url" {
  description = "Base URL of the vault API"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "aws_region" {
  value = var.aws_region
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.cli.id
}

output "data_bucket" {
  value = aws_s3_bucket.data.bucket
}

output "logs_bucket" {
  value = aws_s3_bucket.logs.bucket
}

output "table_name" {
  value = aws_dynamodb_table.files.name
}

output "kms_key_arn" {
  value = aws_kms_key.main.arn
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}
