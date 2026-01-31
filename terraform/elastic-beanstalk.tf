# Elastic Beanstalk Application
resource "aws_elastic_beanstalk_application" "api" {
  name        = "${var.project_name}-api"
  description = "Ship API - Express + WebSocket collaboration server"

  tags = {
    Name = "${var.project_name}-api"
  }
}

# EB Instance IAM Role
resource "aws_iam_role" "eb_instance" {
  name = "${var.project_name}-eb-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-eb-instance-role"
  }
}

# Attach AWS managed policies
resource "aws_iam_role_policy_attachment" "eb_web_tier" {
  role       = aws_iam_role.eb_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier"
}

resource "aws_iam_role_policy_attachment" "eb_worker_tier" {
  role       = aws_iam_role.eb_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWorkerTier"
}

resource "aws_iam_role_policy_attachment" "eb_multicontainer_docker" {
  role       = aws_iam_role.eb_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkMulticontainerDocker"
}

# Instance Profile
resource "aws_iam_instance_profile" "eb" {
  name = "${var.project_name}-eb-instance-profile"
  role = aws_iam_role.eb_instance.name

  tags = {
    Name = "${var.project_name}-eb-instance-profile"
  }
}

# EB Service Role
resource "aws_iam_role" "eb_service" {
  name = "${var.project_name}-eb-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "elasticbeanstalk.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "sts:ExternalId" = "elasticbeanstalk"
          }
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-eb-service-role"
  }
}

resource "aws_iam_role_policy_attachment" "eb_service_policy" {
  role       = aws_iam_role.eb_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth"
}

resource "aws_iam_role_policy_attachment" "eb_service_managed" {
  role       = aws_iam_role.eb_service.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy"
}

# Elastic Beanstalk Environment
resource "aws_elastic_beanstalk_environment" "api" {
  name                = "${var.project_name}-api-prod"
  application         = aws_elastic_beanstalk_application.api.name
  solution_stack_name = "64bit Amazon Linux 2023 v4.9.0 running Docker"

  # VPC Configuration
  setting {
    namespace = "aws:ec2:vpc"
    name      = "VPCId"
    value     = aws_vpc.main.id
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "Subnets"
    value     = join(",", aws_subnet.private[*].id)
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "ELBSubnets"
    value     = join(",", aws_subnet.public[*].id)
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "ELBScheme"
    value     = "public"
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "AssociatePublicIpAddress"
    value     = "false"
  }

  # Instance Configuration
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "IamInstanceProfile"
    value     = aws_iam_instance_profile.eb.name
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "InstanceType"
    value     = "t3.small"
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "SecurityGroups"
    value     = aws_security_group.eb_instance.id
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "DisableIMDSv1"
    value     = "true"
  }

  # Auto Scaling
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MinSize"
    value     = "1"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MaxSize"
    value     = "4"
  }

  # Load Balancer
  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "EnvironmentType"
    value     = "LoadBalanced"
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "LoadBalancerType"
    value     = "application"
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "ServiceRole"
    value     = aws_iam_role.eb_service.arn
  }

  setting {
    namespace = "aws:elbv2:loadbalancer"
    name      = "SecurityGroups"
    value     = aws_security_group.alb.id
  }

  # Rolling Deployment with Additional Batch (zero-downtime)
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "DeploymentPolicy"
    value     = "RollingWithAdditionalBatch"
  }

  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSizeType"
    value     = "Fixed"
  }

  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSize"
    value     = "1"
  }

  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "Timeout"
    value     = "600"
  }

  # Environment Variables
  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "NODE_ENV"
    value     = "production"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "ENVIRONMENT"
    value     = "prod"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "PORT"
    value     = "80"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "AWS_REGION"
    value     = var.aws_region
  }

  # CloudWatch Audit Log Group (for FedRAMP AU-9 compliance)
  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "CLOUDWATCH_AUDIT_LOG_GROUP"
    value     = aws_cloudwatch_log_group.audit_logs.name
  }

  # Health Check Path
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "HealthCheckPath"
    value     = "/health"
  }

  # Health Reporting
  setting {
    namespace = "aws:elasticbeanstalk:healthreporting:system"
    name      = "SystemType"
    value     = "enhanced"
  }

  # Ignore version_label changes (managed by deploy script)
  lifecycle {
    ignore_changes = [
      version_label,
    ]
  }

  tags = {
    Name = "${var.project_name}-api-prod"
  }
}

# CloudWatch Log Group for FedRAMP AU-9 Compliant Audit Logs
# This provides true immutability - the app can write but IAM prevents delete/modify
resource "aws_cloudwatch_log_group" "audit_logs" {
  name              = "/ship/audit-logs/prod"
  retention_in_days = 1096  # 3 years (minimum that exceeds 30-month FedRAMP requirement)

  tags = {
    Name        = "${var.project_name}-audit-logs-prod"
    Environment = "prod"
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

output "eb_application_name" {
  description = "Elastic Beanstalk application name"
  value       = aws_elastic_beanstalk_application.api.name
}

output "eb_environment_name" {
  description = "Elastic Beanstalk environment name"
  value       = aws_elastic_beanstalk_environment.api.name
}

output "eb_environment_url" {
  description = "Elastic Beanstalk environment URL"
  value       = aws_elastic_beanstalk_environment.api.endpoint_url
}

output "eb_instance_profile" {
  description = "Instance profile for EB instances"
  value       = aws_iam_instance_profile.eb.name
}

output "eb_service_role" {
  description = "Service role ARN for EB"
  value       = aws_iam_role.eb_service.arn
}

output "eb_vpc_id" {
  description = "VPC ID for EB environment"
  value       = aws_vpc.main.id
}

output "eb_private_subnets" {
  description = "Private subnet IDs for EB instances"
  value       = join(",", aws_subnet.private[*].id)
}

output "eb_public_subnets" {
  description = "Public subnet IDs for ALB"
  value       = join(",", aws_subnet.public[*].id)
}

output "eb_instance_security_group" {
  description = "Security group for EB instances"
  value       = aws_security_group.eb_instance.id
}

output "eb_alb_security_group" {
  description = "Security group for ALB"
  value       = aws_security_group.alb.id
}

output "audit_log_group_name" {
  description = "CloudWatch Log Group name for audit logs (FedRAMP AU-9)"
  value       = aws_cloudwatch_log_group.audit_logs.name
}

output "audit_log_group_arn" {
  description = "CloudWatch Log Group ARN for audit logs"
  value       = aws_cloudwatch_log_group.audit_logs.arn
}
