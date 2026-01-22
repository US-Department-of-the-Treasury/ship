# =============================================================================
# Shared SES Outputs
# =============================================================================
# These outputs are for the shared SES domain identity and DKIM configuration.
# VPC endpoints are created per-environment, not here.
# =============================================================================

output "ses_domain_identity_arn" {
  description = "ARN of the SES domain identity"
  value       = aws_ses_domain_identity.main.arn
}

output "ses_domain" {
  description = "Verified SES domain"
  value       = aws_ses_domain_identity.main.domain
}

output "ses_dkim_tokens" {
  description = "DKIM tokens (for reference)"
  value       = aws_ses_domain_dkim.main.dkim_tokens
}

output "ssm_ses_domain_path" {
  description = "SSM parameter path for SES domain"
  value       = aws_ssm_parameter.ses_domain.name
}

output "ssm_ses_domain_arn_path" {
  description = "SSM parameter path for SES domain ARN"
  value       = aws_ssm_parameter.ses_domain_arn.name
}
