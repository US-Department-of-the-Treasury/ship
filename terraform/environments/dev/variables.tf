variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
  default     = "ship"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "ship_main"
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for DNS records (optional)"
  type        = string
  default     = ""
}

variable "api_domain_name" {
  description = "Custom domain for API (e.g., api.example.gov)"
  type        = string
  default     = ""
}

variable "app_domain_name" {
  description = "Custom domain for frontend (e.g., app.example.gov)"
  type        = string
  default     = ""
}

variable "aurora_min_capacity" {
  description = "Aurora Serverless v2 minimum capacity (ACUs)"
  type        = number
  default     = 0.5
}

variable "aurora_max_capacity" {
  description = "Aurora Serverless v2 maximum capacity (ACUs)"
  type        = number
  default     = 4
}

variable "eb_environment_cname" {
  description = "Elastic Beanstalk environment CNAME for API routing through CloudFront"
  type        = string
  default     = ""
}

variable "upload_cors_origins" {
  description = "Allowed origins for file upload CORS (browser direct-to-S3 uploads)"
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"]
}
