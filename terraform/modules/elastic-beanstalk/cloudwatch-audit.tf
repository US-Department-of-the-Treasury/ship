# CloudWatch Log Group for FedRAMP AU-9 Compliant Audit Logs
# This provides true immutability - the app can write but IAM prevents delete/modify

resource "aws_cloudwatch_log_group" "audit_logs" {
  name              = "/ship/audit-logs/${var.environment}"
  retention_in_days = 1096  # 3 years (minimum that exceeds 30-month FedRAMP requirement)

  tags = {
    Name        = "${var.project_name}-audit-logs-${var.environment}"
    Environment = var.environment
    Purpose     = "FedRAMP AU-9 Compliant Audit Trail"
  }
}

# IAM Policy for write-only CloudWatch access (AU-9 compliance)
# App can ONLY write logs - no read, no delete, no modify
resource "aws_iam_role_policy" "audit_logs_write_only" {
  name = "audit-logs-write-only"
  role = aws_iam_role.eb_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCreateLogStream"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream"
        ]
        Resource = "${aws_cloudwatch_log_group.audit_logs.arn}:*"
      },
      {
        Sid    = "AllowPutLogEvents"
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.audit_logs.arn}:*"
      }
      # NOTE: Deliberately NO CreateLogGroup, DeleteLogGroup, DeleteLogStream, DescribeLogStreams
      # This ensures immutability - once written, logs cannot be modified or deleted by the app
    ]
  })
}

# Output the log group name for app configuration
output "audit_log_group_name" {
  description = "CloudWatch Log Group name for audit logs"
  value       = aws_cloudwatch_log_group.audit_logs.name
}

output "audit_log_group_arn" {
  description = "CloudWatch Log Group ARN for audit logs"
  value       = aws_cloudwatch_log_group.audit_logs.arn
}
