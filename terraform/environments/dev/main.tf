# Dev environment - uses shared VPC from treasury-shared-infra

# Read shared VPC configuration from SSM (set by treasury-shared-infra)
data "aws_ssm_parameter" "vpc_id" {
  name = "/infra/dev/vpc_id"
}

data "aws_ssm_parameter" "private_subnet_ids" {
  name = "/infra/dev/private_subnet_ids"
}

data "aws_ssm_parameter" "public_subnet_ids" {
  name = "/infra/dev/public_subnet_ids"
}

data "aws_ssm_parameter" "vpc_cidr" {
  name = "/infra/dev/vpc_cidr"
}

locals {
  vpc_id             = data.aws_ssm_parameter.vpc_id.value
  private_subnet_ids = split(",", data.aws_ssm_parameter.private_subnet_ids.value)
  public_subnet_ids  = split(",", data.aws_ssm_parameter.public_subnet_ids.value)
  vpc_cidr           = data.aws_ssm_parameter.vpc_cidr.value
}

# Security Groups (create within shared VPC)
module "security_groups" {
  source = "../../modules/security-groups"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = local.vpc_id
}

# Aurora Serverless v2 Database (dev has its own isolated database)
module "aurora" {
  source = "../../modules/aurora"

  project_name = var.project_name
  environment  = var.environment

  vpc_id            = local.vpc_id
  subnet_ids        = local.private_subnet_ids
  security_group_id = module.security_groups.aurora_security_group_id

  db_name      = var.db_name
  min_capacity = var.aurora_min_capacity
  max_capacity = var.aurora_max_capacity
}

# Elastic Beanstalk (dev uses shared VPC)
module "elastic_beanstalk" {
  source = "../../modules/elastic-beanstalk"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  vpc_id                        = local.vpc_id
  private_subnet_ids            = local.private_subnet_ids
  public_subnet_ids             = local.public_subnet_ids
  alb_security_group_id         = module.security_groups.alb_security_group_id
  eb_instance_security_group_id = module.security_groups.eb_instance_security_group_id
}

# CloudFront + S3 Frontend (dev has its own CDN + bucket)
module "cloudfront_s3" {
  source = "../../modules/cloudfront-s3"

  project_name         = var.project_name
  environment          = var.environment
  app_domain_name      = var.app_domain_name
  route53_zone_id      = var.route53_zone_id
  eb_environment_cname = var.eb_environment_cname
  upload_cors_origins  = var.upload_cors_origins
}

# SSM Parameters (dev has environment-specific paths)
module "ssm" {
  source = "../../modules/ssm"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  db_endpoint            = module.aurora.cluster_endpoint
  db_port                = 5432
  db_name                = var.db_name
  db_username            = module.aurora.master_username
  db_password            = module.aurora.master_password
  cloudfront_domain_name = module.cloudfront_s3.cloudfront_domain_name
  app_domain_name        = var.app_domain_name
  eb_instance_role_name  = module.elastic_beanstalk.instance_role_name
}

# SES VPC Endpoint (private access to SES API)
# Dev creates the VPC endpoint for the shared VPC. Shadow reads from SSM.
module "ses_vpc_endpoint" {
  source = "../../modules/ses-vpc-endpoint"

  project_name = var.project_name
  aws_region   = var.aws_region
  vpc_name     = "dev"  # Shared VPC name for SSM paths
  vpc_id       = local.vpc_id
  vpc_cidr     = local.vpc_cidr
  subnet_ids   = local.private_subnet_ids
}

# SES Email Configuration
# Prerequisites: Run terraform/shared/ses first to create shared SES resources
module "ses" {
  source = "../../modules/ses"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  eb_instance_role_name = module.elastic_beanstalk.instance_role_name
  ses_from_email        = var.ses_from_email
  ses_from_name         = var.ses_from_name
  app_url               = "https://${var.app_domain_name}"
  ses_vpc_endpoint_id   = module.ses_vpc_endpoint.vpc_endpoint_id
}
