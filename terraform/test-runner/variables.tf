variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type (c7i.metal-48xl = 192 vCPU, 384GB RAM)"
  type        = string
  default     = "c7i.metal-48xl"
}

variable "key_name" {
  description = "EC2 key pair name for SSH access"
  type        = string
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed to SSH (default: anywhere)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
