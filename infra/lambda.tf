# Zips are built from ../dist/<name>/ (run `npm run build` before plan/apply).
data "archive_file" "lambda" {
  for_each = local.handlers

  type        = "zip"
  source_dir  = "${path.module}/../dist/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.handlers

  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  description      = "Vault API: presigned uploads/downloads, listing, deletion, audit"
  role             = aws_iam_role.api.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda["api"].output_path
  source_code_hash = data.archive_file.lambda["api"].output_base64sha256
  memory_size      = local.handlers.api.memory
  timeout          = local.handlers.api.timeout

  environment {
    variables = {
      TABLE_NAME               = aws_dynamodb_table.files.name
      BUCKET_NAME              = aws_s3_bucket.data.bucket
      KMS_KEY_ARN              = aws_kms_key.main.arn
      MAX_FILE_SIZE_BYTES      = tostring(var.max_file_size_bytes)
      ALLOWED_CONTENT_TYPES    = var.allowed_content_types
      UPLOAD_URL_TTL_SECONDS   = tostring(var.upload_url_ttl_seconds)
      DOWNLOAD_URL_TTL_SECONDS = tostring(var.download_url_ttl_seconds)
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.api]
}

resource "aws_sqs_queue" "finalize_dlq" {
  name                      = "${local.name}-finalize-dlq"
  message_retention_seconds = 1209600 # 14 days
  kms_master_key_id         = aws_kms_key.main.id
}

resource "aws_lambda_function" "finalize" {
  function_name    = "${local.name}-finalize"
  description      = "Verifies every uploaded object against its registration; deletes anything that does not comply"
  role             = aws_iam_role.finalize.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda["finalize"].output_path
  source_code_hash = data.archive_file.lambda["finalize"].output_base64sha256
  memory_size      = local.handlers.finalize.memory
  timeout          = local.handlers.finalize.timeout

  environment {
    variables = {
      TABLE_NAME  = aws_dynamodb_table.files.name
      BUCKET_NAME = aws_s3_bucket.data.bucket
      KMS_KEY_ARN = aws_kms_key.main.arn
    }
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.finalize_dlq.arn
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.finalize]
}

resource "aws_lambda_permission" "s3_invoke_finalize" {
  statement_id   = "AllowS3Invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.finalize.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.data.arn
  source_account = data.aws_caller_identity.current.account_id
}
