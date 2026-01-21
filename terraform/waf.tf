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

resource "aws_wafv2_web_acl" "cloudfront" {
  count       = var.cloudfront_waf_web_acl_id == "" ? 1 : 0
  name        = "${var.project_name}-${var.environment}-cloudfront-waf"
  description = "WAF WebACL for ${var.project_name} CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Rule 1: Rate limiting - 300 requests per 5 minutes per IP
  rule {
    name     = "RateBasedRule-IP-300"
    priority = 0

    action {
      count {} # Count mode - monitor before blocking
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
    priority = 1

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
    priority = 2

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
    priority = 3

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
    priority = 4

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
    priority = 5

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
    priority = 6

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
