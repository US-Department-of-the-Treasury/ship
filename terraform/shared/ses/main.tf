# =============================================================================
# Shared SES Infrastructure (Domain & DKIM Only)
# =============================================================================
# These resources are created ONCE and shared across all environments.
# Run this separately before environment-specific infrastructure.
#
# Creates:
# - SES domain identity with Easy DKIM
# - Route53 DKIM CNAME records
# - SSM parameters for other modules to reference
#
# NOTE: VPC endpoints are NOT created here. Each VPC creates its own
# endpoint to ensure traffic stays within that VPC's network.
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment after initial apply to enable remote state
  # backend "s3" {
  #   bucket = "ship-terraform-state-ACCOUNT_ID"
  #   key    = "ship/shared-ses/terraform.tfstate"
  #   region = "us-east-1"
  #   encrypt = true
  # }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# SES Domain Identity
# -----------------------------------------------------------------------------

resource "aws_ses_domain_identity" "main" {
  domain = var.ses_domain
}

# -----------------------------------------------------------------------------
# Easy DKIM Configuration
# -----------------------------------------------------------------------------

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

# DKIM CNAME records in Route53
resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey.${var.ses_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# -----------------------------------------------------------------------------
# SES Domain Verification (TXT record)
# -----------------------------------------------------------------------------

resource "aws_route53_record" "ses_verification" {
  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.ses_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main.verification_token]
}

resource "aws_ses_domain_identity_verification" "main" {
  domain = aws_ses_domain_identity.main.id

  depends_on = [aws_route53_record.ses_verification]
}

# -----------------------------------------------------------------------------
# SSM Parameters (for other modules to reference)
# -----------------------------------------------------------------------------

resource "aws_ssm_parameter" "ses_domain" {
  name        = "/ship/ses/domain"
  description = "SES verified domain for email sending"
  type        = "String"
  value       = aws_ses_domain_identity.main.domain

  tags = {
    Name = "ship-ses-domain"
  }
}

resource "aws_ssm_parameter" "ses_domain_arn" {
  name        = "/ship/ses/domain-arn"
  description = "ARN of the SES domain identity"
  type        = "String"
  value       = aws_ses_domain_identity.main.arn

  tags = {
    Name = "ship-ses-domain-arn"
  }
}
