# =============================================================================
# SES VPC Endpoint Outputs
# =============================================================================

output "vpc_endpoint_id" {
  description = "ID of the SES VPC endpoint"
  value       = aws_vpc_endpoint.ses.id
}

output "dns_entry" {
  description = "DNS entries for the VPC endpoint"
  value       = aws_vpc_endpoint.ses.dns_entry
}
