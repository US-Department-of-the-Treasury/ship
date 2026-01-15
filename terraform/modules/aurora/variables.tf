variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for Aurora cluster"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for Aurora"
  type        = string
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "ship_main"
}

variable "min_capacity" {
  description = "Aurora Serverless v2 minimum capacity (ACUs)"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Aurora Serverless v2 maximum capacity (ACUs)"
  type        = number
  default     = 4
}
