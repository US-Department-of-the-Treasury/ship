# =============================================================================
# Shadow Environment - Unified Document Model v2 Migration Testing
# =============================================================================
#
# PURPOSE:
# This environment is isolated specifically for testing the UDM v2 migration.
# It mirrors the dev environment structure but has its own:
# - Aurora PostgreSQL cluster (can be created from dev snapshot)
# - Elastic Beanstalk application and environment
# - CloudFront distribution and S3 bucket
#
# This allows running destructive migration tests without affecting dev data.
#
# USAGE:
# 1. Create a snapshot of the dev Aurora cluster
# 2. Set snapshot_identifier in terraform.tfvars
# 3. terraform apply to create shadow environment from snapshot
# 4. Run migration tests
# 5. terraform destroy when testing is complete
#
# =============================================================================

# Read shared VPC configuration from SSM (same VPC as dev)
# The shadow environment runs in the same VPC but with isolated resources
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

# Security Groups (shadow environment has its own security groups in the shared VPC)
module "security_groups" {
  source = "../../modules/security-groups"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = local.vpc_id
}

# Aurora Serverless v2 Database
# NOTE: Can be created from a dev database snapshot for migration testing
# Set snapshot_identifier in tfvars to restore from snapshot
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

  # NOTE: snapshot_identifier support would need to be added to the aurora module
  # For now, shadow environment creates a fresh database
}

# Elastic Beanstalk (shadow has its own EB application and environment)
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

# CloudFront + S3 Frontend (shadow has its own CDN + bucket)
module "cloudfront_s3" {
  source = "../../modules/cloudfront-s3"

  project_name         = var.project_name
  environment          = var.environment
  app_domain_name      = var.app_domain_name
  route53_zone_id      = var.route53_zone_id
  eb_environment_cname = var.eb_environment_cname
}

# SSM Parameters (shadow has its own parameter paths: /ship/shadow/...)
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

# SES VPC Endpoint ID (read from SSM - created by dev environment)
# Shadow shares the VPC with dev, so it uses the same VPC endpoint.
data "aws_ssm_parameter" "ses_vpc_endpoint_id" {
  name = "/infra/dev/ses-vpc-endpoint-id"
}

# SES Email Configuration
# Prerequisites:
# 1. Run terraform/shared/ses first to create shared SES resources
# 2. Apply dev environment first to create the VPC endpoint
module "ses" {
  source = "../../modules/ses"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  eb_instance_role_name = module.elastic_beanstalk.instance_role_name
  ses_from_email        = var.ses_from_email
  ses_from_name         = var.ses_from_name
  app_url               = "https://${var.app_domain_name}"
  ses_vpc_endpoint_id   = data.aws_ssm_parameter.ses_vpc_endpoint_id.value
}
