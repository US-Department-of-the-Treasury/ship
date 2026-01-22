output "ses_from_email_ssm_path" {
  description = "SSM parameter path for SES from email"
  value       = aws_ssm_parameter.ses_from_email.name
}

output "ses_from_name_ssm_path" {
  description = "SSM parameter path for SES from name"
  value       = aws_ssm_parameter.ses_from_name.name
}

output "app_url_ssm_path" {
  description = "SSM parameter path for app URL"
  value       = aws_ssm_parameter.app_url.name
}
