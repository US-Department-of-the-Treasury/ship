output "application_name" {
  description = "Elastic Beanstalk application name"
  value       = aws_elastic_beanstalk_application.api.name
}

output "environment_name" {
  description = "Elastic Beanstalk environment name"
  value       = aws_elastic_beanstalk_environment.api.name
}

output "environment_url" {
  description = "Elastic Beanstalk environment URL"
  value       = aws_elastic_beanstalk_environment.api.endpoint_url
}

output "environment_cname" {
  description = "Elastic Beanstalk environment CNAME"
  value       = aws_elastic_beanstalk_environment.api.cname
}

output "instance_profile_name" {
  description = "Instance profile name for EB instances"
  value       = aws_iam_instance_profile.eb.name
}

output "instance_role_name" {
  description = "Instance IAM role name"
  value       = aws_iam_role.eb_instance.name
}

output "instance_role_arn" {
  description = "Instance IAM role ARN"
  value       = aws_iam_role.eb_instance.arn
}

output "service_role_arn" {
  description = "Service role ARN for EB"
  value       = aws_iam_role.eb_service.arn
}
