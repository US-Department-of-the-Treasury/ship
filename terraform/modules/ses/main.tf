# =============================================================================
# SES Module (Per-Environment)
# =============================================================================
# Creates environment-specific SES configuration:
# - SSM parameters for email service (from-email, from-name, app-url)
# - IAM policy for SES sending attached to EB instance role
#
# Prerequisites: Run terraform/shared/ses first to create the shared SES
# domain identity and DKIM.
#
# NOTE: The VPC endpoint ID is passed in from the environment. Each VPC
# creates its own endpoint to ensure traffic stays within that VPC's network.
# =============================================================================

data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Read Shared SES Configuration from SSM
# -----------------------------------------------------------------------------

data "aws_ssm_parameter" "ses_domain_arn" {
  name = "/ship/ses/domain-arn"
}

# -----------------------------------------------------------------------------
# SSM Parameters for Email Service
# -----------------------------------------------------------------------------

resource "aws_ssm_parameter" "ses_from_email" {
  name        = "/${var.project_name}/${var.environment}/ses/from-email"
  description = "SES From email address for ${var.environment}"
  type        = "SecureString"
  value       = var.ses_from_email

  tags = {
    Name = "${var.project_name}-${var.environment}-ses-from-email"
  }
}

resource "aws_ssm_parameter" "ses_from_name" {
  name        = "/${var.project_name}/${var.environment}/ses/from-name"
  description = "SES From display name for ${var.environment}"
  type        = "String"
  value       = var.ses_from_name

  tags = {
    Name = "${var.project_name}-${var.environment}-ses-from-name"
  }
}

resource "aws_ssm_parameter" "app_url" {
  name        = "/${var.project_name}/${var.environment}/app-url"
  description = "Application URL for email invite links"
  type        = "String"
  value       = var.app_url

  tags = {
    Name = "${var.project_name}-${var.environment}-app-url"
  }
}

# -----------------------------------------------------------------------------
# IAM Policy for SES Sending
# -----------------------------------------------------------------------------
# Least-privilege policy:
# - Only allows SendEmail/SendRawEmail
# - Only for verified SES domain identity
# - Only with approved From addresses (explicit list, no wildcards)
# - Only through the VPC endpoint

resource "aws_iam_role_policy" "eb_ses_send" {
  name = "${var.project_name}-${var.environment}-eb-ses-send"
  role = var.eb_instance_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSesSendFromApprovedAddresses"
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = data.aws_ssm_parameter.ses_domain_arn.value
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_approved_from_addresses
            "aws:SourceVpce"  = var.ses_vpc_endpoint_id
          }
        }
      },
      {
        Sid    = "DenySesSendIfNotFromVpce"
        Effect = "Deny"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
        Condition = {
          StringNotEqualsIfExists = {
            "aws:SourceVpce" = var.ses_vpc_endpoint_id
          }
        }
      }
    ]
  })
}
