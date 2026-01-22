# =============================================================================
# SES Module Variables (Per-Environment)
# =============================================================================

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, shadow, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "eb_instance_role_name" {
  description = "Name of the EB instance IAM role to attach SES policy"
  type        = string
}

variable "ses_from_email" {
  description = "From email address for this environment"
  type        = string
}

variable "ses_from_name" {
  description = "From display name for this environment"
  type        = string
}

variable "app_url" {
  description = "Application URL for invite links"
  type        = string
}

variable "ses_vpc_endpoint_id" {
  description = "VPC endpoint ID for SES (created per-VPC)"
  type        = string
}

variable "ses_approved_from_addresses" {
  description = "List of approved From addresses for IAM policy (all environments)"
  type        = list(string)
  default = [
    "noreply@ship.awsdev.treasury.gov",
    "noreply-dev@ship.awsdev.treasury.gov",
    "noreply-shadow@ship.awsdev.treasury.gov"
  ]
}
