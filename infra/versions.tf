terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60.0, < 7.0.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Keep state out of git. Uncomment and fill in for real deployments:
  # backend "s3" {
  #   bucket         = "my-terraform-state"
  #   key            = "secure-file-vault/terraform.tfstate"
  #   region         = "ap-south-1"
  #   encrypt        = true
  #   dynamodb_table = "my-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
