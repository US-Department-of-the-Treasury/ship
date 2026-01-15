data "aws_caller_identity" "current" {}

# S3 Bucket for React Frontend (includes account ID for global uniqueness)
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-frontend-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-${var.environment}-frontend"
  }
}

# Block all public access (CloudFront will use OAC)
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning for compliance
resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-${var.environment}-frontend-oac"
  description                       = "OAC for ${var.project_name} ${var.environment} frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} ${var.environment} Frontend - React static site with API routing"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # US, Canada, Europe only

  aliases = var.app_domain_name != "" ? [var.app_domain_name] : []

  # Origin 1: S3 for static assets
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Origin 2: Elastic Beanstalk API (conditional - only when CNAME is provided)
  dynamic "origin" {
    for_each = var.eb_environment_cname != "" ? [1] : []
    content {
      domain_name = var.eb_environment_cname
      origin_id   = "EB-API"

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  # API routes - forward to EB (only when EB is configured)
  dynamic "ordered_cache_behavior" {
    for_each = var.eb_environment_cname != "" ? [1] : []
    content {
      path_pattern           = "/api/*"
      target_origin_id       = "EB-API"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true
      min_ttl                = 0
      default_ttl            = 0
      max_ttl                = 0

      forwarded_values {
        query_string = true
        headers      = ["*"] # Forward all headers including CloudFront-Forwarded-Proto for trust proxy
        cookies {
          forward = "all"
        }
      }
    }
  }

  # Health check endpoint (only when EB is configured)
  dynamic "ordered_cache_behavior" {
    for_each = var.eb_environment_cname != "" ? [1] : []
    content {
      path_pattern           = "/health"
      target_origin_id       = "EB-API"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true
      min_ttl                = 0
      default_ttl            = 0
      max_ttl                = 0

      forwarded_values {
        query_string = false
        cookies {
          forward = "none"
        }
      }
    }
  }

  # WebSocket collaboration endpoint (only when EB is configured)
  dynamic "ordered_cache_behavior" {
    for_each = var.eb_environment_cname != "" ? [1] : []
    content {
      path_pattern           = "/collaboration/*"
      target_origin_id       = "EB-API"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      compress               = false
      min_ttl                = 0
      default_ttl            = 0
      max_ttl                = 0

      forwarded_values {
        query_string = true
        headers      = ["*"]
        cookies {
          forward = "all"
        }
      }
    }
  }

  # Well-known endpoints for OAuth/OIDC (JWKS, etc.) - only when EB is configured
  dynamic "ordered_cache_behavior" {
    for_each = var.eb_environment_cname != "" ? [1] : []
    content {
      path_pattern           = "/.well-known/*"
      target_origin_id       = "EB-API"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true
      min_ttl                = 0
      default_ttl            = 3600 # Cache JWKS for 1 hour
      max_ttl                = 86400

      forwarded_values {
        query_string = false
        cookies {
          forward = "none"
        }
      }
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # SPA routing - redirect 404s to index.html
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 300
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 300
  }

  viewer_certificate {
    cloudfront_default_certificate = var.app_domain_name == ""
    acm_certificate_arn            = var.app_domain_name != "" ? aws_acm_certificate.app[0].arn : null
    ssl_support_method             = var.app_domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-frontend-cdn"
  }
}

# S3 bucket policy for CloudFront OAC
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

# ACM Certificate for custom domain (must be in us-east-1 for CloudFront)
resource "aws_acm_certificate" "app" {
  count             = var.app_domain_name != "" ? 1 : 0
  domain_name       = var.app_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-app-cert"
  }
}

# Route53 record for ACM validation
resource "aws_route53_record" "app_cert_validation" {
  for_each = var.app_domain_name != "" && var.route53_zone_id != "" ? {
    for dvo in aws_acm_certificate.app[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

# Certificate validation
resource "aws_acm_certificate_validation" "app" {
  count                   = var.app_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for record in aws_route53_record.app_cert_validation : record.fqdn]
}

# Route53 record for CloudFront distribution
resource "aws_route53_record" "app" {
  count   = var.app_domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.app_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
