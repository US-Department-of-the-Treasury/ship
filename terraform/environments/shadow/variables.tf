# =============================================================================
# Shadow Environment Variables
# =============================================================================
# For migration testing, set snapshot_identifier to restore from a dev snapshot.
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
  default     = "ship"
}

variable "environment" {
  description = "Environment name - always 'shadow' for this environment"
  type        = string
  default     = "shadow"
}

variable "db_name" {
  description = "Database name (ignored when restoring from snapshot)"
  type        = string
  default     = "ship_main"
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for DNS records (optional)"
  type        = string
  default     = ""
}

variable "api_domain_name" {
  description = "Custom domain for API (e.g., api-shadow.example.gov)"
  type        = string
  default     = ""
}

variable "app_domain_name" {
  description = "Custom domain for frontend (e.g., app-shadow.example.gov)"
  type        = string
  default     = ""
}

variable "aurora_min_capacity" {
  description = "Aurora Serverless v2 minimum capacity (ACUs)"
  type        = number
  default     = 0.5
}

variable "aurora_max_capacity" {
  description = "Aurora Serverless v2 maximum capacity (ACUs)"
  type        = number
  default     = 4
}

variable "eb_environment_cname" {
  description = "Elastic Beanstalk environment CNAME for API routing through CloudFront"
  type        = string
  default     = ""
}

# =============================================================================
# Migration Testing Variables
# =============================================================================

variable "snapshot_identifier" {
  description = <<-EOT
    Aurora cluster snapshot identifier to restore from.

    For migration testing:
    1. Create a manual snapshot of the dev Aurora cluster
    2. Set this to the snapshot identifier (e.g., "ship-dev-aurora-migration-test-2024-01-16")

    When set:
    - New cluster is created from the snapshot
    - db_name is ignored (inherited from snapshot)
    - master_username is inherited from snapshot
    - A new master_password is generated

    When empty:
    - Fresh Aurora cluster is created with empty database
  EOT
  type        = string
  default     = ""
}

# =============================================================================
# SES Email Configuration
# =============================================================================

variable "ses_from_email" {
  description = "From email address for this environment"
  type        = string
  default     = ""
}

variable "ses_from_name" {
  description = "From display name for this environment"
  type        = string
  default     = "Ship"
}
