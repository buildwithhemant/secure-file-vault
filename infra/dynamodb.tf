# Single table: FILE# and AUDIT# items under one USER#<sub> partition key,
# so every query is naturally scoped to one user.
resource "aws_dynamodb_table" "files" {
  name         = "${local.name}-files"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }

  # Audit items carry an expiresAt epoch; file items never set it.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  deletion_protection_enabled = var.environment == "prod"
}
