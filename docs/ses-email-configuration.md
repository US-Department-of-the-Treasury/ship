# AWS SES Email Configuration Guide

A secure, production-ready pattern for sending transactional emails from AWS applications using SES with VPC isolation and email authentication.

## Why This Pattern?

Sending email from applications requires addressing three concerns:

1. **Network Security**: Email API calls should not traverse the public internet
2. **Authorization**: Only specific application roles should send email, and only from approved addresses
3. **Email Authentication**: Emails must pass SPF, DKIM, and DMARC checks to avoid spam folders

This guide provides a reusable pattern that addresses all three concerns using:
- **VPC Endpoints** (PrivateLink) for network isolation
- **IAM Policies** with sender address and VPC endpoint conditions
- **Easy DKIM** for automatic email signing
- **DMARC inheritance** from parent domains (especially important for government)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Application VPC                         │
│  ┌─────────────┐     ┌──────────────────┐     ┌──────────┐  │
│  │    API      │────▶│  SES VPC Endpoint │────▶│ AWS SES  │  │
│  │  (ECS/EC2)  │     │  (PrivateLink)    │     │          │  │
│  └─────────────┘     └──────────────────┘     └──────────┘  │
│         │                                           │        │
│         ▼                                           ▼        │
│  IAM Role with                              Verified Domain  │
│  SES Send Policy                           (your-domain.gov) │
└─────────────────────────────────────────────────────────────┘
```

**Traffic flow:**
1. Application calls SES SDK (SendEmail/SendRawEmail)
2. SDK routes through VPC endpoint (private connection, no internet)
3. IAM policy validates: correct sender address + request came from VPC endpoint
4. SES sends email with DKIM signature

---

## Configuration Components

### 1. SES Domain Identity

Verify your sending domain in SES. This enables:
- Sending from any address `*@your-domain.com`
- DKIM signing with your domain
- DMARC alignment with your domain

**Best Practice**: Use a single domain identity shared across environments (dev, staging, prod). Differentiate environments using sender address prefixes.

| Environment | From Address | Example |
|-------------|--------------|---------|
| Production | `noreply@your-domain.com` | Clean address for real users |
| Staging | `noreply-staging@your-domain.com` | Clearly marked as non-production |
| Development | `noreply-dev@your-domain.com` | Easy filtering in test inboxes |

**Why shared domain?**
- Only one domain verification required
- Only 3 DKIM records (not 3 per environment)
- Consistent DMARC alignment
- IAM policy can explicitly list all approved addresses (no wildcards)

---

### 2. VPC Endpoint

Create a VPC endpoint for SES so API calls never leave the private network.

| Setting | Value |
|---------|-------|
| Service name | `com.amazonaws.{region}.email-smtp` |
| VPC | Your application VPC |
| Subnets | Private subnets where API runs |
| Security group | Allow HTTPS (443) from VPC CIDR |
| Private DNS | **Enabled** |

With private DNS enabled, the AWS SDK automatically routes SES calls through the endpoint—no code changes required.

**Multi-environment strategy:**
- Environments sharing a VPC share the endpoint
- Environments with separate VPCs need their own endpoints
- Store endpoint IDs in SSM for IAM policy reference

---

### 3. IAM Policy

The IAM policy is the enforcement point. It should:
1. **Allow** SES actions only for your verified identity
2. **Allow** only from explicitly approved sender addresses
3. **Deny** any request not originating from the VPC endpoint

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
      "Resource": "arn:aws:ses:{region}:{account-id}:identity/{your-domain.com}",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": [
            "noreply@your-domain.com",
            "noreply-staging@your-domain.com",
            "noreply-dev@your-domain.com"
          ],
          "aws:SourceVpce": "{vpce-id}"
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
          "aws:SourceVpce": "{vpce-id}"
        }
      }
    }
  ]
}
```

**Key points:**
- `StringEquals` with an array acts as implicit OR (any listed address is allowed)
- The explicit `Deny` statement blocks requests from outside the VPC endpoint
- No wildcards in sender addresses—each must be explicitly approved

---

### 4. DKIM Configuration (Easy DKIM)

Easy DKIM automatically signs every email with a 2048-bit key managed by SES.

**Setup:**
1. Enable Easy DKIM when verifying your domain in SES
2. SES generates 3 CNAME records
3. Add these records to your DNS (Route53 or other)

**DNS records format:**

| Name | Type | Value |
|------|------|-------|
| `{token1}._domainkey.your-domain.com` | CNAME | `{token1}.dkim.amazonses.com` |
| `{token2}._domainkey.your-domain.com` | CNAME | `{token2}.dkim.amazonses.com` |
| `{token3}._domainkey.your-domain.com` | CNAME | `{token3}.dkim.amazonses.com` |

SES generates the actual token values during domain verification.

---

### 5. SPF Configuration

SPF is handled automatically by SES. By default:
- MAIL FROM: `{unique-id}@{region}.amazonses.com`
- SPF passes because the MAIL FROM domain matches SES's servers

**Optional: Custom MAIL FROM**

For stricter SPF alignment (MAIL FROM matches your domain), add these DNS records:

| Name | Type | Value |
|------|------|-------|
| `mail.your-domain.com` | MX | `10 feedback-smtp.{region}.amazonses.com` |
| `mail.your-domain.com` | TXT | `"v=spf1 include:amazonses.com ~all"` |

This is optional—default SES SPF is sufficient for most use cases.

---

### 6. DMARC Configuration

DMARC determines what happens when emails fail authentication. The key decision: **inherit from parent domain or create your own policy?**

**For government domains (.gov):** Most .gov domains have strict DMARC policies (`p=reject`). Creating a subdomain DMARC record with `p=none` would **weaken** security. Instead, inherit the parent policy.

**For other domains:** If your parent domain has no DMARC or a weak policy, consider adding:
```
_dmarc.your-domain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@your-domain.com"
```

**DMARC alignment requirements:**
- SPF alignment: MAIL FROM domain matches From header domain
- DKIM alignment: DKIM `d=` domain matches From header domain

With Easy DKIM configured for your sending domain, DKIM alignment passes automatically, satisfying DMARC.

---

## Terraform Module Structure

Organize infrastructure as reusable modules:

```
terraform/
├── shared/
│   └── ses/                    # One-time: domain identity + DKIM
│       ├── main.tf             # SES domain, DKIM, Route53 records
│       └── outputs.tf          # domain_arn → SSM
├── modules/
│   ├── ses/                    # Per-environment: SSM params, IAM policy
│   │   └── main.tf
│   └── ses-vpc-endpoint/       # Per-VPC: endpoint + security group
│       └── main.tf
└── environments/
    ├── dev/                    # Uses ses + ses-vpc-endpoint modules
    ├── staging/                # May share VPC endpoint with dev
    └── prod/                   # Own VPC endpoint
```

**Deployment order:**
1. Deploy `shared/ses` once (creates domain identity, publishes DKIM records)
2. Deploy each environment (creates VPC endpoints, IAM policies)

---

## Runtime Configuration (SSM Parameters)

Store email configuration in SSM Parameter Store for runtime loading:

```
/{app}/{env}/ses/from-email   # e.g., noreply-dev@your-domain.com
/{app}/{env}/ses/from-name    # e.g., Your App (Dev)
/{app}/{env}/app-url          # e.g., https://dev.your-app.com
```

The application loads these based on `ENVIRONMENT` variable.

---

## Validation Checklist

Before go-live, verify:

### Email Authentication
Send a test email and check headers:
```
Authentication-Results: ...
  dkim=pass header.d=your-domain.com;
  spf=pass ...;
  dmarc=pass (p=REJECT ...) header.from=your-domain.com
```

### VPC Endpoint Enforcement
Attempt to send email from outside the VPC (e.g., your laptop). Expect:
```
AccessDeniedException: User: arn:aws:sts::{account}:assumed-role/...
is not authorized to perform: ses:SendEmail on resource:
arn:aws:ses:{region}:{account}:identity/your-domain.com
with an explicit deny in an identity-based policy
```

### GRC Documentation
Collect these artifacts:
- Screenshot of SES domain verification (Verified status)
- Screenshot of Easy DKIM status (Successful)
- Route53 DKIM CNAME records
- IAM policy document attached to API execution role

---

## Example: Ship Application

Ship is a Treasury.gov application that uses this pattern for workspace invitation emails.

### Domain Configuration

| Setting | Value |
|---------|-------|
| Domain | `ship.awsdev.treasury.gov` |
| Region | `us-east-1` |
| Parent DMARC | `p=reject` (inherited from treasury.gov) |

### Environment Addresses

| Environment | From Address | From Name |
|-------------|--------------|-----------|
| prod | `noreply@ship.awsdev.treasury.gov` | Ship |
| shadow | `noreply-shadow@ship.awsdev.treasury.gov` | Ship (Shadow) |
| dev | `noreply-dev@ship.awsdev.treasury.gov` | Ship (Dev) |

### SSM Parameters

```
/ship/dev/ses/from-email     = noreply-dev@ship.awsdev.treasury.gov
/ship/dev/ses/from-name      = Ship (Dev)
/ship/dev/app-url            = https://dev.ship.awsdev.treasury.gov

/ship/shadow/ses/from-email  = noreply-shadow@ship.awsdev.treasury.gov
/ship/shadow/ses/from-name   = Ship (Shadow)
/ship/shadow/app-url         = https://shadow.ship.awsdev.treasury.gov

/ship/prod/ses/from-email    = noreply@ship.awsdev.treasury.gov
/ship/prod/ses/from-name     = Ship
/ship/prod/app-url           = https://ship.awsdev.treasury.gov
```

### VPC Endpoint Strategy

- **Dev + Shadow** share a VPC → share one VPC endpoint at `/infra/dev/ses-vpc-endpoint-id`
- **Prod** has its own VPC → own endpoint at `/infra/prod/ses-vpc-endpoint-id`

### IAM Policy (Ship-specific)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesSendFromApprovedAddresses",
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "arn:aws:ses:us-east-1:ACCOUNT_ID:identity/ship.awsdev.treasury.gov",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": [
            "noreply@ship.awsdev.treasury.gov",
            "noreply-dev@ship.awsdev.treasury.gov",
            "noreply-shadow@ship.awsdev.treasury.gov"
          ],
          "aws:SourceVpce": "vpce-XXXXXXXXX"
        }
      }
    },
    {
      "Sid": "DenySesSendIfNotFromVpce",
      "Effect": "Deny",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*",
      "Condition": {
        "StringNotEqualsIfExists": {
          "aws:SourceVpce": "vpce-XXXXXXXXX"
        }
      }
    }
  ]
}
```

### DMARC Decision

Ship does **not** create a subdomain DMARC record. Treasury.gov's policy:
```
v=DMARC1; p=reject; fo=1; rua=mailto:reports@dmarc.cyber.dhs.gov,mailto:reports@treasury.gov
```

Creating a subdomain record would weaken this inherited `p=reject` policy. Instead, Ship relies on DKIM alignment to pass DMARC.

### Deployment

Ship uses a consolidated deployment script:
```bash
./scripts/deploy-all.sh <dev|shadow|prod>
```

This script:
1. Checks if shared SES infrastructure exists → deploys if missing
2. Checks if environment infrastructure exists → deploys if missing
3. Initializes terraform and deploys API
4. Deploys frontend

The script is idempotent and safe to run multiple times.

---

## References

- [AWS SES Developer Guide](https://docs.aws.amazon.com/ses/latest/dg/)
- [AWS SES Custom MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)
- [BOD 18-01: Email Authentication](https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security)
- [DMARC Specification (RFC 7489)](https://datatracker.ietf.org/doc/html/rfc7489)
