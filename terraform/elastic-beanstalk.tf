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

# Note: Environment will be created manually via EB CLI
# This allows for faster deployments and better control
output "eb_application_name" {
  description = "Elastic Beanstalk application name (use with EB CLI)"
  value       = aws_elastic_beanstalk_application.api.name
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
