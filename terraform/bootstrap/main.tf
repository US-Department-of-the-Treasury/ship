# Bootstrap configuration for Terraform remote state
# Run this ONCE to create the S3 bucket, then enable the backend in ../versions.tf

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = "ship-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "Terraform State"
    Project   = "ship"
    ManagedBy = "Terraform"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_caller_identity" "current" {}

# Store bucket name in SSM for team discovery (avoids committing account ID to git)
resource "aws_ssm_parameter" "terraform_state_bucket" {
  name        = "/ship/terraform-state-bucket"
  description = "S3 bucket name for Terraform state - query this during terraform init"
  type        = "String"
  value       = aws_s3_bucket.terraform_state.id

  tags = {
    Project   = "ship"
    ManagedBy = "Terraform"
  }
}

output "bucket_name" {
  description = "S3 bucket name for terraform state - use this in ../versions.tf backend config"
  value       = aws_s3_bucket.terraform_state.id
}

output "backend_config" {
  description = "Copy this to ../versions.tf"
  value       = <<-EOT
    backend "s3" {
      bucket  = "${aws_s3_bucket.terraform_state.id}"
      key     = "ship/terraform.tfstate"
      region  = "us-east-1"
      encrypt = true
    }
  EOT
}
