output "database_url_parameter_name" {
  description = "SSM parameter name for DATABASE_URL"
  value       = aws_ssm_parameter.database_url.name
}

output "cors_origin_parameter_name" {
  description = "SSM parameter name for CORS_ORIGIN"
  value       = aws_ssm_parameter.cors_origin.name
}

output "session_secret_parameter_name" {
  description = "SSM parameter name for SESSION_SECRET"
  value       = aws_ssm_parameter.session_secret.name
}

output "app_base_url_parameter_name" {
  description = "SSM parameter name for APP_BASE_URL"
  value       = aws_ssm_parameter.app_base_url.name
}
