# Aurora Security Group
resource "aws_security_group" "aurora" {
  name        = "${var.project_name}-aurora"
  description = "Aurora database security group - ingress only from EB"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-aurora"
  }
}

# Aurora ingress rule (added separately so EB can reference it)
resource "aws_security_group_rule" "aurora_ingress_from_eb" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.aurora.id
  source_security_group_id = aws_security_group.eb_instance.id
  description              = "Allow PostgreSQL from EB instances"
}

# No outbound rules for Aurora (database doesn't need outbound)

# Elastic Beanstalk Instance Security Group
resource "aws_security_group" "eb_instance" {
  name        = "${var.project_name}-eb-instance"
  description = "Elastic Beanstalk instance security group"
  vpc_id      = aws_vpc.main.id

  # Allow inbound from ALB
  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "Allow HTTP from ALB"
  }

  # Allow all outbound (for package downloads, AWS API calls)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = {
    Name = "${var.project_name}-eb-instance"
  }
}

# Application Load Balancer Security Group
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "ALB security group - public access"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from anywhere
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow HTTP from anywhere"
  }

  # Allow HTTPS from anywhere
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow HTTPS from anywhere"
  }

  # Allow all outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = {
    Name = "${var.project_name}-alb"
  }
}
