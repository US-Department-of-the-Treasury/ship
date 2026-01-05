# EC2 Test Runner - Beefy on-demand instance for E2E tests
#
# Usage:
#   cd terraform/test-runner
#   terraform init
#   terraform apply
#
# Then add to ~/.ssh/config:
#   Host test-runner
#     HostName <elastic_ip from output>
#     User ubuntu
#     IdentityFile ~/.ssh/<your-key>.pem

# Use default VPC for simplicity (no NAT gateway costs)
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Get latest Ubuntu 24.04 AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security group - SSH only
resource "aws_security_group" "test_runner" {
  name        = "ship-test-runner"
  description = "SSH access for E2E test runner"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ship-test-runner"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# On-demand instance (guaranteed availability)
resource "aws_instance" "test_runner" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  vpc_security_group_ids      = [aws_security_group.test_runner.id]
  subnet_id                   = data.aws_subnets.default.ids[0]
  key_name                    = var.key_name
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 200
    volume_type           = "gp3"
    iops                  = 16000
    throughput            = 1000
    delete_on_termination = true
  }

  user_data = base64encode(file("${path.module}/user-data.sh"))

  tags = {
    Name = "ship-test-runner"
  }
}

# Elastic IP for stable address
resource "aws_eip" "test_runner" {
  domain = "vpc"

  tags = {
    Name = "ship-test-runner"
  }
}

resource "aws_eip_association" "test_runner" {
  instance_id   = aws_instance.test_runner.id
  allocation_id = aws_eip.test_runner.id
}
