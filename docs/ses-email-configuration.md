# SES Email Configuration for Ship

This document describes the AWS SES configuration for sending workspace invitation emails from Ship.

## Overview

Ship sends transactional emails (workspace invitations) via AWS SES. The configuration enforces:
- Least-privilege IAM permissions
- Network isolation via VPC endpoint
- Email authentication (DKIM/SPF/DMARC compliance)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Ship VPC                              │
│  ┌─────────────┐     ┌──────────────────┐     ┌──────────┐  │
│  │  Ship API   │────▶│  SES VPC Endpoint │────▶│ AWS SES  │  │
│  │  (ECS/EC2)  │     │  (PrivateLink)    │     │          │  │
│  └─────────────┘     └──────────────────┘     └──────────┘  │
│         │                                           │        │
│         ▼                                           ▼        │
│  IAM Role with                              Verified Domain  │
│  SES Send Policy                      ship.awsdev.treasury.gov│
└─────────────────────────────────────────────────────────────┘
```

## Terraform Infrastructure

### Module Structure

```
terraform/
├── shared/
│   └── ses/                    # Shared SES domain & DKIM (run once)
│       ├── main.tf             # SES domain identity, DKIM, Route53 records
│       ├── variables.tf
│       └── outputs.tf
├── modules/
│   ├── ses/                    # Per-environment SES config
│   │   ├── main.tf             # SSM parameters, IAM policy
│   │   └── variables.tf
│   └── ses-vpc-endpoint/       # Per-VPC SES endpoint
│       ├── main.tf             # VPC endpoint, security group, SSM param
│       └── variables.tf
└── environments/
    ├── dev/                    # Creates VPC endpoint for shared VPC
    ├── shadow/                 # Reads VPC endpoint ID from SSM (shares with dev)
    └── prod/                   # Creates VPC endpoint for prod VPC
```

### Deployment Order

1. **Shared SES (once)**: `terraform/shared/ses`
   - Creates SES domain identity with Easy DKIM
   - Publishes DKIM CNAME records to Route53
   - Stores domain ARN in SSM: `/ship/ses/domain-arn`

2. **Dev environment**: `terraform/environments/dev`
   - Creates VPC endpoint for shared dev VPC
   - Stores endpoint ID in SSM: `/infra/dev/ses-vpc-endpoint-id`
   - Creates IAM policy and SSM parameters for dev

3. **Shadow environment**: `terraform/environments/shadow`
   - Reads VPC endpoint ID from `/infra/dev/ses-vpc-endpoint-id` (shares endpoint with dev)
   - Creates IAM policy and SSM parameters for shadow

4. **Prod environment**: `terraform/environments/prod`
   - Creates VPC endpoint for prod VPC
   - Stores endpoint ID in SSM: `/infra/prod/ses-vpc-endpoint-id`
   - Creates IAM policy and SSM parameters for prod

### VPC Endpoint Strategy

- **Dev + Shadow** share a VPC → share one VPC endpoint
- **Prod** has its own VPC → has its own VPC endpoint
- Each environment's IAM policy references the appropriate endpoint ID

### Consolidated Deployment Script

Use `deploy-all.sh` for one-command deployment:

```bash
./scripts/deploy-all.sh <dev|shadow|prod>
```

This script:
1. Checks if shared SES infrastructure exists → deploys if missing
2. Checks if environment infrastructure exists → deploys if missing
3. Initializes terraform and deploys API to Elastic Beanstalk
4. Deploys frontend to CloudFront/S3

The script is idempotent and safe to run multiple times.

## IAM Configuration

### Dedicated IAM Role

Create a dedicated IAM role/principal for SES sending and attach a least-privilege IAM policy scoped to the SES identity ARN.

### IAM Policy

The policy authorizes `ses:SendEmail` and `ses:SendRawEmail` only for:
- The verified SES identity
- Explicitly approved From addresses (one per environment)
- Requests originating from the SES VPC endpoint

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesSendFromApprovedAddresses",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "arn:aws:ses:us-east-1:ACCOUNT_ID:identity/ship.awsdev.treasury.gov",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": [
            "noreply@ship.awsdev.treasury.gov",
            "noreply-dev@ship.awsdev.treasury.gov",
            "noreply-shadow@ship.awsdev.treasury.gov"
          ],
          "aws:SourceVpce": "vpce-PLACEHOLDER"
        }
      }
    },
    {
      "Sid": "DenySesSendIfNotFromVpce",
      "Effect": "Deny",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEqualsIfExists": {
          "aws:SourceVpce": "vpce-PLACEHOLDER"
        }
      }
    }
  ]
}
```

**Configuration Values:**

| Parameter | Value | Description |
|-----------|-------|-------------|
| Region | `us-east-1` | AWS region where SES identity is verified |
| Account | `ACCOUNT_ID` | AWS account ID (replace with actual) |
| Domain | `ship.awsdev.treasury.gov` | Verified SES domain identity |
| VPCE | `vpce-PLACEHOLDER` | VPC endpoint ID (replace after creation) |

**Difference from template:** The template uses a single `ses:FromAddress` value. We use an array of three explicit addresses (one per environment) because all environments share the same SES domain identity. The `StringEquals` condition with an array acts as an implicit OR—any of the three addresses is permitted.

### Why Three Explicit Addresses?

A single SES domain identity (`ship.awsdev.treasury.gov`) is shared across all environments:

| Environment | From Address | Purpose |
|-------------|--------------|---------|
| prod | `noreply@ship.awsdev.treasury.gov` | Production emails |
| shadow | `noreply-shadow@ship.awsdev.treasury.gov` | UAT/staging emails |
| dev | `noreply-dev@ship.awsdev.treasury.gov` | Development emails |

This approach:
- Requires only one domain verification in SES
- Requires only 3 DKIM CNAME records (not 9)
- Allows email filtering by environment prefix
- Prevents wildcards in IAM policy (more secure)

## SES VPC Endpoint

All SES API calls must traverse a VPC endpoint (PrivateLink), ensuring email sending traffic never touches the public internet.

### Endpoint Configuration

| Setting | Value |
|---------|-------|
| Service name | `com.amazonaws.us-east-1.email-smtp` |
| VPC | Ship VPC |
| Subnets | Private subnets where API runs |
| Security group | Allow HTTPS (443) from VPC CIDR |
| Private DNS | Enabled |

With private DNS enabled, the AWS SDK automatically routes SES API calls through the endpoint.

## DKIM Configuration (Easy DKIM)

Easy DKIM automatically adds a 2048-bit DKIM signature to every email sent from the verified identity. The keys are auto-generated by SES.

### Setup Steps

1. Verify domain `ship.awsdev.treasury.gov` in SES console
2. Enable Easy DKIM during verification
3. SES provides 3 CNAME records for DKIM
4. Publish CNAME records in Route53

### DKIM DNS Records

SES generates three CNAME records in this format:

| Name | Type | Value |
|------|------|-------|
| `{token1}._domainkey.ship.awsdev.treasury.gov` | CNAME | `{token1}.dkim.amazonses.com` |
| `{token2}._domainkey.ship.awsdev.treasury.gov` | CNAME | `{token2}.dkim.amazonses.com` |
| `{token3}._domainkey.ship.awsdev.treasury.gov` | CNAME | `{token3}.dkim.amazonses.com` |

The actual token values are generated when you verify the domain in SES.

## SPF Configuration

SPF is implicitly handled by SES by default. Amazon SES uses a subdomain of `amazonses.com` as the default MAIL FROM domain, and SPF authentication passes because the MAIL FROM domain matches the sending application (SES).

### Default Behavior (No Configuration Required)

With the default MAIL FROM domain, SPF works automatically:
- MAIL FROM: `{unique-id}@us-east-1.amazonses.com`
- SPF check passes against `amazonses.com` SPF record

### Custom MAIL FROM Domain (Optional)

For stricter SPF alignment where the MAIL FROM domain matches our sending domain, configure a custom MAIL FROM subdomain:

| Name | Type | Value |
|------|------|-------|
| `mail.ship.awsdev.treasury.gov` | MX | `10 feedback-smtp.us-east-1.amazonses.com` |
| `mail.ship.awsdev.treasury.gov` | TXT | `"v=spf1 include:amazonses.com ~all"` |

Reference: [AWS SES Custom MAIL FROM Documentation](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)

**Note:** Custom MAIL FROM is optional and marked as low priority. The default SES MAIL FROM provides adequate SPF authentication for most use cases.

## DMARC Configuration

### Important: No Subdomain DMARC Record

**Difference from template:** The template suggests creating a subdomain DMARC record with `p=none`. We explicitly do NOT create a subdomain DMARC record.

**Reason:** Treasury.gov has a strict DMARC policy:

```
v=DMARC1; p=reject; fo=1; rua=mailto:reports@dmarc.cyber.dhs.gov,mailto:reports@treasury.gov
```

Key points:
- `p=reject` means emails failing DMARC are rejected
- This policy applies to all subdomains (including `ship.awsdev.treasury.gov`) unless overridden
- Creating a subdomain DMARC record with `p=none` would **weaken** the inherited policy
- We inherit `p=reject` to maintain the strictest security posture

### DMARC Alignment

For DMARC to pass, emails must pass either:
- **SPF alignment**: MAIL FROM domain aligns with From header domain
- **DKIM alignment**: DKIM `d=` domain aligns with From header domain

With Easy DKIM configured for `ship.awsdev.treasury.gov`, DKIM alignment passes because:
- From header: `noreply@ship.awsdev.treasury.gov`
- DKIM signature: `d=ship.awsdev.treasury.gov`

This ensures DMARC passes via DKIM alignment, satisfying the inherited `p=reject` policy.

## SSM Parameters

Email configuration is loaded at runtime from SSM Parameter Store:

### Parameter Paths by Environment

**Development (`/ship/dev/`):**
```
/ship/dev/ses/from-email  = noreply-dev@ship.awsdev.treasury.gov
/ship/dev/ses/from-name   = Ship (Dev)
/ship/dev/app-url         = https://dev.ship.awsdev.treasury.gov
```

**Shadow/UAT (`/ship/shadow/`):**
```
/ship/shadow/ses/from-email  = noreply-shadow@ship.awsdev.treasury.gov
/ship/shadow/ses/from-name   = Ship (Shadow)
/ship/shadow/app-url         = https://shadow.ship.awsdev.treasury.gov
```

**Production (`/ship/prod/`):**
```
/ship/prod/ses/from-email  = noreply@ship.awsdev.treasury.gov
/ship/prod/ses/from-name   = Ship
/ship/prod/app-url         = https://ship.awsdev.treasury.gov
```

The API determines which parameters to load based on the `ENVIRONMENT` environment variable.

## Validation and Evidence (GRC Artifact)

Upon completion, produce an artifact for GRC demonstrating:

### 1. Successful Email Delivery

Test email headers showing:
- `dkim=pass` (header.d=ship.awsdev.treasury.gov)
- `spf=pass` or `spf=softpass`
- `dmarc=pass`

Example Authentication-Results header:
```
Authentication-Results: mx.google.com;
  dkim=pass header.d=ship.awsdev.treasury.gov;
  spf=pass (google.com: domain of bounce@us-east-1.amazonses.com designates ... as permitted sender);
  dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=ship.awsdev.treasury.gov
```

### 2. VPC Endpoint Enforcement

Evidence that SES send attempts originating outside the VPC endpoint are denied:

```
AccessDeniedException: User: arn:aws:sts::ACCOUNT_ID:assumed-role/ShipApiRole/...
is not authorized to perform: ses:SendEmail on resource:
arn:aws:ses:us-east-1:ACCOUNT_ID:identity/ship.awsdev.treasury.gov
with an explicit deny in an identity-based policy
```

### 3. Supporting Documentation

- Screenshot of SES domain verification status (Verified)
- Screenshot of Easy DKIM status (Successful)
- Route53 DKIM CNAME records
- IAM policy attached to API execution role

## Summary of Differences from Template

| Aspect | Template | Our Configuration | Reason |
|--------|----------|-------------------|--------|
| From Address | Single address | Three explicit addresses | Single SES domain shared across environments |
| IAM Condition | `StringEquals` with string | `StringEquals` with array | Multiple addresses, implicit OR |
| DMARC Record | Create with `p=none` | Do not create | Inherit `p=reject` from treasury.gov |
| Custom MAIL FROM | Implied required | Optional (low priority) | Default SES SPF is sufficient |

## References

- [AWS SES Developer Guide](https://docs.aws.amazon.com/ses/latest/dg/)
- [AWS SES Custom MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)
- [BOD 18-01: Email Authentication](https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security)
- [DMARC Specification (RFC 7489)](https://datatracker.ietf.org/doc/html/rfc7489)
