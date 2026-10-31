variable "project_name" {
  description = "Short name used as a prefix for every resource."
  type        = string
  default     = "secure-file-vault"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name must be lowercase letters, digits and dashes, 2 to 31 characters."
  }
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "max_file_size_bytes" {
  description = "Largest upload the API will issue a presigned URL for."
  type        = number
  default     = 104857600 # 100 MiB
}

variable "allowed_content_types" {
  description = "Comma-separated allow-list of content types (`image/*`, `application/pdf`, ...). `*` allows everything."
  type        = string
  default     = "*"
}

variable "upload_url_ttl_seconds" {
  description = "Lifetime of presigned upload URLs."
  type        = number
  default     = 300
}

variable "download_url_ttl_seconds" {
  description = "Lifetime of presigned download URLs."
  type        = number
  default     = 60
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed to call the API."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "alarm_email" {
  description = "Email address subscribed to the alarm topic. Leave empty to skip the subscription."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Retention for Lambda, API access and S3 access logs."
  type        = number
  default     = 30
}

variable "noncurrent_version_expiration_days" {
  description = "How long deleted/overwritten object versions stay recoverable."
  type        = number
  default     = 30
}

variable "throttling_burst_limit" {
  description = "API Gateway burst limit (requests)."
  type        = number
  default     = 50
}

variable "throttling_rate_limit" {
  description = "API Gateway steady-state limit (requests per second)."
  type        = number
  default     = 25
}

variable "force_destroy" {
  description = "Let `terraform destroy` delete buckets that still contain objects. Keep false outside dev."
  type        = bool
  default     = false
}
