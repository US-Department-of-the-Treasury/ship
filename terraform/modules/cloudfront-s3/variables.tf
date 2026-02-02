variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
}

variable "app_domain_name" {
  description = "Custom domain for frontend (e.g., app.example.gov)"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for DNS records"
  type        = string
  default     = ""
}

variable "eb_environment_cname" {
  description = "Elastic Beanstalk environment CNAME for API routing"
  type        = string
  default     = ""
}

variable "upload_cors_origins" {
  description = "Allowed origins for file upload CORS (browser direct-to-S3 uploads)"
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"]
}
