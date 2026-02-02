# WAF WebACL for CloudFront protection
# Creates a WebACL with AWS managed rules when no external WAF ARN is provided

resource "aws_wafv2_ip_set" "bad_ips" {
  count              = var.cloudfront_waf_web_acl_id == "" ? 1 : 0
  name               = "${var.project_name}-${var.environment}-bad-ips"
  description        = "IP addresses to block"
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = [] # Manually populate as needed

  tags = {
    Name        = "${var.project_name}-bad-ips"
    Environment = var.environment
  }
}

# Regex pattern set for static file exemptions (used by AntiDDoS rule)
resource "aws_wafv2_regex_pattern_set" "static_files" {
  count       = var.cloudfront_waf_web_acl_id == "" ? 1 : 0
  name        = "${var.project_name}-${var.environment}-static-files"
  description = "Static file extensions exempt from DDoS challenges"
  scope       = "CLOUDFRONT"

  regular_expression {
    regex_string = "\\/api\\/|\\.(acc|avi|css|gif|ico|jpe?g|js|json|mp[34]|ogg|otf|pdf|png|tiff?|ttf|webm|webp|woff2?|xml)$"
  }

  tags = {
    Name        = "${var.project_name}-static-files"
    Environment = var.environment
  }
}

resource "aws_wafv2_web_acl" "cloudfront" {
  count       = var.cloudfront_waf_web_acl_id == "" ? 1 : 0
  name        = "${var.project_name}-${var.environment}-cloudfront-waf"
  description = "WAF WebACL for ${var.project_name} CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Rule 0: AWS Anti-DDoS Rule Set - DISABLED
  # Requires managed_rule_group_configs block that Terraform AWS provider doesn't
  # fully support yet. Enable via AWS Console if needed.
  # See: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/wafv2_web_acl

  # Rule 1: Rate limiting - 300 requests per 5 minutes per IP
  # DDoS protection: BLOCK mode actively stops volumetric attacks at the edge
  rule {
    name     = "RateBasedRule-IP-300"
    priority = 1

    action {
      block {
        custom_response {
          response_code = 429
          response_header {
            name  = "Retry-After"
            value = "300"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit              = 300
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-RateBasedRule-IP-300"
    }
  }

  # Rule 2: AWS IP Reputation List
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSIpReputationList"
    }
  }

  # Rule 3: AWS Common Rule Set (OWASP Top 10)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSCommonRuleSet"
    }
  }

  # Rule 4: AWS Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSKnownBadInputs"
    }
  }

  # Rule 5: AWS SQL Injection Rules
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSSQLiRuleSet"
    }
  }

  # Rule 6: Custom Bad IPs block list
  rule {
    name     = "BadIPs"
    priority = 6

    action {
      block {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.bad_ips[0].arn
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-BadIPs"
    }
  }

  # Rule 7: AWS Bot Control (Common level, count mode for most categories)
  rule {
    name     = "AWSManagedRulesBotControlRuleSet"
    priority = 7

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesBotControlRuleSet"

        managed_rule_group_configs {
          aws_managed_rules_bot_control_rule_set {
            inspection_level = "COMMON"
          }
        }

        # Override to count mode for benign bot categories
        rule_action_override {
          name = "CategoryAdvertising"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryAI"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryArchiver"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryContentFetcher"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryEmailClient"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryHttpLibrary"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryLinkChecker"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryMiscellaneous"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryMonitoring"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategoryScrapingFramework"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategorySearchEngine"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategorySecurity"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategorySeo"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "CategorySocialMedia"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "SignalAutomatedBrowser"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "SignalKnownBotDataCenter"
          action_to_use {
            count {}
          }
        }
        rule_action_override {
          name = "SignalNonBrowserUserAgent"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-AWSBotControl"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-CloudFrontWAF"
  }

  tags = {
    Name        = "${var.project_name}-cloudfront-waf"
    Environment = var.environment
  }
}
