# =============================================================================
# Shadow Environment - Terraform Configuration
# =============================================================================
# NOTE: State is stored separately from dev/prod in ship/shadow/terraform.tfstate
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend bucket name from SSM (compliance requirement)
  # Initialize with: terraform init -backend-config="bucket=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)"
  backend "s3" {
    key     = "ship/shadow/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "ship"
      Purpose     = "UDM-v2-Migration-Testing"
    }
  }
}
