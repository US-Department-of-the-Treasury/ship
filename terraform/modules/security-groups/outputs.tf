output "alb_security_group_id" {
  description = "Security group ID for ALB"
  value       = aws_security_group.alb.id
}

output "eb_instance_security_group_id" {
  description = "Security group ID for EB instances"
  value       = aws_security_group.eb_instance.id
}

output "aurora_security_group_id" {
  description = "Security group ID for Aurora"
  value       = aws_security_group.aurora.id
}
