# =============================================================================
# SES VPC Endpoint Variables
# =============================================================================

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "aws_region" {
  description = "AWS region for the VPC endpoint service name"
  type        = string
  default     = "us-east-1"
}

variable "vpc_name" {
  description = "Name of the VPC for resource naming and SSM paths (e.g., 'dev', 'prod')"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the endpoint will be created"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group rules"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for the VPC endpoint"
  type        = list(string)
}
