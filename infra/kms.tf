# One customer-managed key encrypts the objects, the metadata table, the
# dead-letter queue and the alarm topic. Only the two Lambda roles (and the
# account root, for administration) may use it.

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "EnableRootPermissions"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowVaultFunctions"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.api.arn, aws_iam_role.finalize.arn]
    }
  }

  statement {
    sid       = "AllowCloudWatchAlarmsToUseEncryptedTopic"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
  }

  statement {
    sid       = "AllowS3ToDeliverToEncryptedQueue"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.name}: file objects, metadata table, DLQ and alarm topic"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}
