# =============================================================================
# SES VPC Endpoint Module
# =============================================================================
# Creates a VPC endpoint for SES to allow private API access.
# Each VPC should have its own endpoint to ensure traffic stays within
# that VPC's network.
#
# When multiple environments share a VPC (e.g., dev and shadow), only one
# environment should create the endpoint and store the ID in SSM. Other
# environments should reference it via SSM data source.
# =============================================================================

# -----------------------------------------------------------------------------
# Security Group for VPC Endpoint
# -----------------------------------------------------------------------------
# Allows HTTPS (443) traffic from within the VPC CIDR.
# This covers all environments that share this VPC.

resource "aws_security_group" "ses_endpoint" {
  name        = "${var.project_name}-${var.vpc_name}-ses-endpoint"
  description = "Security group for SES VPC endpoint - allows HTTPS from VPC CIDR"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Allow HTTPS from VPC CIDR"
  }

  tags = {
    Name = "${var.project_name}-${var.vpc_name}-ses-endpoint"
  }
}

# -----------------------------------------------------------------------------
# SES VPC Endpoint (Interface Endpoint)
# -----------------------------------------------------------------------------

resource "aws_vpc_endpoint" "ses" {
  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.email-smtp"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.subnet_ids
  security_group_ids  = [aws_security_group.ses_endpoint.id]
  private_dns_enabled = true

  tags = {
    Name = "${var.project_name}-${var.vpc_name}-ses-endpoint"
  }
}

# -----------------------------------------------------------------------------
# SSM Parameter for VPC Endpoint ID
# -----------------------------------------------------------------------------
# Store the endpoint ID in SSM so other environments sharing this VPC can
# reference it without creating duplicate endpoints.

resource "aws_ssm_parameter" "ses_vpc_endpoint_id" {
  name        = "/infra/${var.vpc_name}/ses-vpc-endpoint-id"
  description = "SES VPC endpoint ID for the ${var.vpc_name} VPC"
  type        = "String"
  value       = aws_vpc_endpoint.ses.id

  tags = {
    Name = "${var.project_name}-${var.vpc_name}-ses-vpc-endpoint-id"
  }
}
