# Two roles, each with exactly the permissions its function needs, on exactly
# the resources it touches. No managed policies, no wildcards on resources.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "finalize" {
  name               = "${local.name}-finalize"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda["api"].arn}:*"]
  }

  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  statement {
    sid       = "MetadataTable"
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.files.arn]
  }

  # Presigned URLs are signed with this role, so it must be allowed to do what
  # the URL does, and only under the per-user prefix.
  statement {
    sid       = "UserObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.data.arn}/users/*"]
  }

  statement {
    sid       = "UseVaultKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "vault-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

data "aws_iam_policy_document" "finalize" {
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda["finalize"].arn}:*"]
  }

  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  statement {
    sid       = "MetadataTable"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.files.arn]
  }

  statement {
    sid       = "InspectAndRemoveUserObjects"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.data.arn}/users/*"]
  }

  statement {
    sid       = "UseVaultKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }

  statement {
    sid       = "DeadLetter"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.finalize_dlq.arn]
  }
}

resource "aws_iam_role_policy" "finalize" {
  name   = "vault-finalize"
  role   = aws_iam_role.finalize.id
  policy = data.aws_iam_policy_document.finalize.json
}
