# CloudFront Real-time Logging Infrastructure
# Kinesis stream + IAM role + Real-time log configuration

# Kinesis Data Stream for CloudFront logs
resource "aws_kinesis_stream" "cloudfront_logs" {
  name             = "${var.project_name}-${var.environment}-cloudfront-logs"
  shard_count      = 4
  retention_period = 4320 # 180 days (in hours)

  encryption_type = "KMS"
  kms_key_id      = "alias/aws/kinesis"

  stream_mode_details {
    stream_mode = "PROVISIONED"
  }

  tags = {
    Name        = "${var.project_name}-cloudfront-logs"
    Environment = var.environment
  }
}

# IAM Role for CloudFront to write to Kinesis
resource "aws_iam_role" "cloudfront_realtime_logs" {
  name = "${var.project_name}-${var.environment}-cf-realtime-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-cf-realtime-logs-role"
    Environment = var.environment
  }
}

# IAM Policy for CloudFront to write to Kinesis
resource "aws_iam_role_policy" "cloudfront_realtime_logs" {
  name = "${var.project_name}-${var.environment}-cf-realtime-logs"
  role = aws_iam_role.cloudfront_realtime_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kinesis:DescribeStreamSummary",
          "kinesis:DescribeStream",
          "kinesis:PutRecord",
          "kinesis:PutRecords"
        ]
        Resource = aws_kinesis_stream.cloudfront_logs.arn
      }
    ]
  })
}

# CloudFront Real-time Log Configuration
resource "aws_cloudfront_realtime_log_config" "main" {
  name          = "${var.project_name}-${var.environment}-realtime-logs"
  sampling_rate = 100

  endpoint {
    stream_type = "Kinesis"

    kinesis_stream_config {
      role_arn   = aws_iam_role.cloudfront_realtime_logs.arn
      stream_arn = aws_kinesis_stream.cloudfront_logs.arn
    }
  }

  # All available fields for comprehensive logging
  fields = [
    "timestamp",
    "c-ip",
    "s-ip",
    "time-to-first-byte",
    "sc-status",
    "sc-bytes",
    "cs-method",
    "cs-protocol",
    "cs-host",
    "cs-uri-stem",
    "cs-bytes",
    "x-edge-location",
    "x-edge-request-id",
    "x-host-header",
    "time-taken",
    "cs-protocol-version",
    "c-ip-version",
    "cs-user-agent",
    "cs-referer",
    "cs-cookie",
    "cs-uri-query",
    "x-edge-response-result-type",
    "x-forwarded-for",
    "ssl-protocol",
    "ssl-cipher",
    "x-edge-result-type",
    "fle-encrypted-fields",
    "fle-status",
    "sc-content-type",
    "sc-content-len",
    "sc-range-start",
    "sc-range-end",
    "c-port",
    "x-edge-detailed-result-type",
    "c-country",
    "cs-accept-encoding",
    "cs-accept",
    "cache-behavior-path-pattern",
    "cs-headers",
    "cs-header-names",
    "cs-headers-count",
    "primary-distribution-id",
    "primary-distribution-dns-name",
    "origin-fbl",
    "origin-lbl",
    "asn"
  ]

  depends_on = [aws_iam_role_policy.cloudfront_realtime_logs]
}
