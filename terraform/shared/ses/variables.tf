# =============================================================================
# Shared SES Variables
# =============================================================================
# Variables for the shared SES domain identity and DKIM configuration.
# VPC endpoints are created per-environment, not here.
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "ses_domain" {
  description = "Domain for SES email sending"
  type        = string
  default     = "ship.awsdev.treasury.gov"
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for DNS records"
  type        = string
}
