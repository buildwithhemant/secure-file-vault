locals {
  name = "${var.project_name}-${var.environment}"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # One zip per Lambda, built by `npm run build` into ../dist/<name>/
  handlers = {
    api      = { memory = 256, timeout = 10 }
    finalize = { memory = 512, timeout = 30 }
  }

  routes = [
    "POST /files",
    "GET /files",
    "GET /files/{fileId}",
    "GET /files/{fileId}/download",
    "DELETE /files/{fileId}",
    "GET /audit",
  ]
}

data "aws_caller_identity" "current" {}
