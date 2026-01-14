variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

# Database connection info
variable "db_endpoint" {
  description = "Aurora cluster endpoint"
  type        = string
}

variable "db_port" {
  description = "Aurora cluster port"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Database name"
  type        = string
}

variable "db_username" {
  description = "Database master username"
  type        = string
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

# Frontend info
variable "app_domain_name" {
  description = "Custom domain for frontend"
  type        = string
  default     = ""
}

variable "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  type        = string
}

# EB role for IAM policies
variable "eb_instance_role_name" {
  description = "EB instance role name for attaching policies"
  type        = string
}
