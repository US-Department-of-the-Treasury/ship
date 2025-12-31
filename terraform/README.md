# Ship - Terraform Infrastructure

This directory contains all infrastructure as code for deploying Ship to AWS.

## Quick Start

```bash
# 1. Verify AWS credentials (must have access to the team's AWS account)
aws sts get-caller-identity

# 2. Configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# 3. Initialize Terraform (bucket name is fetched from SSM)
terraform init -backend-config="bucket=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)"

# 4. Plan changes
terraform plan -out=tfplan

# 5. Apply changes
terraform apply tfplan
```

## Infrastructure Components

| File | Purpose |
|------|---------|
| `versions.tf` | Provider configuration and versions |
| `variables.tf` | Input variables and defaults |
| `vpc.tf` | VPC, subnets, NAT, Internet Gateway, Flow Logs |
| `security-groups.tf` | Network security for ALB, EB, Aurora |
| `database.tf` | Aurora Serverless v2 PostgreSQL cluster |
| `ssm.tf` | SSM Parameter Store for secrets |
| `elastic-beanstalk.tf` | EB application, IAM roles |
| `s3-cloudfront.tf` | Frontend hosting (S3 + CloudFront) |
| `outputs.tf` | Output values for EB CLI and scripts |

## Resource Architecture

```
VPC (10.0.0.0/16)
├── Public Subnets (10.0.0.0/24, 10.0.1.0/24)
│   ├── Internet Gateway
│   ├── NAT Gateway
│   └── Application Load Balancer
│
└── Private Subnets (10.0.10.0/24, 10.0.11.0/24)
    ├── Elastic Beanstalk Instances
    └── Aurora Serverless v2 Cluster
```

## Configuration

### Required Variables

```hcl
aws_region   = "us-east-1"
project_name = "ship"
environment  = "dev"
```

### Optional Variables

```hcl
# Custom domains (requires Route53 zone)
route53_zone_id  = "Z1234567890ABC"
api_domain_name  = "api.example.gov"
app_domain_name  = "app.example.gov"

# Database scaling
aurora_min_capacity = 0.5  # ACUs
aurora_max_capacity = 4    # ACUs

# VPC configuration
vpc_cidr           = "10.0.0.0/16"
enable_nat_gateway = true  # Required for EB Docker pulls
```

## Important Outputs

After `terraform apply`, note these outputs:

| Output | Used For |
|--------|----------|
| `eb_application_name` | EB CLI initialization |
| `eb_instance_profile` | EB environment creation |
| `eb_service_role` | EB environment creation |
| `eb_vpc_id` | EB environment creation |
| `eb_private_subnets` | EB environment creation |
| `eb_public_subnets` | EB environment creation |
| `database_url_ssm_parameter` | Application configuration |
| `s3_bucket_name` | Frontend deployment |
| `cloudfront_distribution_id` | Frontend deployment |

## State Management

**IMPORTANT:** Terraform state is stored in S3 to prevent data loss. The state file tracks what resources Terraform manages - without it, Terraform cannot destroy or update resources.

### S3 Backend (Current Setup)

State is stored in a private S3 bucket with:
- Versioning enabled (can recover from mistakes)
- Encryption at rest (AES256)
- Public access blocked

The bucket name is **not committed to git** (compliance requirement - avoids exposing AWS account ID). Instead, it's stored in SSM Parameter Store at `/ship/terraform-state-bucket`.

This means:
- State survives git worktree deletion
- State is shared across all machines/worktrees
- No secrets or account identifiers in git
- Team members discover the bucket via SSM

### Initializing Terraform

```bash
# Fetch bucket name from SSM and initialize
terraform init -backend-config="bucket=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)"
```

Or create a local `.tfbackend` file (gitignored):

```bash
# Query once and save locally
echo "bucket = \"$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)\"" > .tfbackend

# Then init is simpler
terraform init -backend-config=.tfbackend
```

### Bootstrap Directory

The `bootstrap/` directory contains Terraform that creates:
1. The S3 bucket for state storage
2. An SSM parameter with the bucket name (for team discovery)

This solves the chicken-and-egg problem (need bucket before you can use it as backend).

**If setting up from scratch (new AWS account):**

```bash
# 1. Create the S3 bucket and SSM parameter (one-time, by team lead)
cd terraform/bootstrap
terraform init
terraform apply

# 2. Initialize main terraform (uses SSM to find bucket)
cd ..
terraform init -backend-config="bucket=$(aws ssm get-parameter --name /ship/terraform-state-bucket --query Parameter.Value --output text)"
```

### Why This Matters

If you deploy from a git worktree and then delete that worktree, you lose the local state file. Without state, Terraform doesn't know what resources it created, and you cannot:
- Run `terraform destroy`
- Update existing resources
- See what's deployed

With S3 backend, state persists regardless of which machine or worktree you use.

### Recovering from Lost State

If state is lost and resources exist in AWS, you have two options:

1. **Import then destroy** - Import each resource into Terraform state, then destroy
2. **Manual cleanup via AWS CLI** - Delete resources directly

For manual cleanup, delete in this order (dependencies matter):
1. Elastic Beanstalk environment
2. RDS cluster and instances
3. CloudFront distribution
4. S3 buckets (empty first)
5. NAT Gateway
6. Security groups
7. Subnets
8. Internet Gateway
9. VPC
10. IAM roles/policies

## Cost Estimation

Use `terraform plan` with cost estimation tools:

```bash
# Using Infracost (https://www.infracost.io/)
infracost breakdown --path .

# Estimated monthly costs (dev environment):
# - Aurora Serverless v2 (0.5 ACU min): $43
# - Elastic Beanstalk (t3.small): $15
# - Application Load Balancer: $20
# - NAT Gateway: $33
# - S3 + CloudFront: $2
# Total: ~$113/month
```

## Maintenance

### Update Terraform

```bash
# Update providers
terraform init -upgrade

# Review changes
terraform plan

# Apply updates
terraform apply
```

### Update Aurora Version

1. Check available versions:
   ```bash
   aws rds describe-db-engine-versions \
     --engine aurora-postgresql \
     --query "DBEngineVersions[].EngineVersion"
   ```

2. Update `database.tf`:
   ```hcl
   engine_version = "16.2"  # New version
   ```

3. Apply changes:
   ```bash
   terraform apply
   ```

Aurora will perform a rolling upgrade during the maintenance window.

## Troubleshooting

### Terraform Init Fails

- Check AWS credentials: `aws sts get-caller-identity`
- Ensure Terraform version >= 1.6.0: `terraform version`

### Terraform Plan Shows Drift

Resources modified outside Terraform will show as changes. Common causes:
- EB auto-scaling changes
- RDS automated backups
- Security group rules added manually

To import resources:
```bash
terraform import aws_security_group_rule.example sg-12345678:ingress:tcp:22:22:0.0.0.0/0
```

### Aurora Creation Timeout

Aurora can take 10-15 minutes to create. If timeout occurs:
- Check RDS console for cluster status
- If cluster is "creating", wait and run `terraform apply` again
- Terraform will pick up the existing cluster

### NAT Gateway Expensive

NAT Gateway costs ~$33/month. For dev environments, you can:
1. Set `enable_nat_gateway = false`
2. Use VPC endpoints for AWS services (ECR, S3, SSM)

However, EB instances need internet access to pull Docker images from ECR Public.

## Security

### Compliance Features

- **Encryption:** Aurora (storage), S3 (AES256), TLS 1.2+ in transit
- **Audit:** VPC Flow Logs, CloudWatch Logs, CloudTrail integration
- **Network:** Private subnets for compute/database, no public IPs
- **IAM:** Least privilege roles, no hardcoded credentials
- **Secrets:** SSM Parameter Store (SecureString with KMS)

### Security Group Rules

All security groups follow least privilege:
- Aurora: Ingress only from EB instances on port 5432, no egress
- EB instances: Ingress from ALB on port 80, egress to internet (for updates)
- ALB: Ingress from internet on 80/443, egress to EB instances

### Secrets Management

Never commit secrets to git. Use SSM Parameter Store:

```bash
# Store secret
aws ssm put-parameter \
  --name "/ship/dev/API_KEY" \
  --type "SecureString" \
  --value "secret-value"

# Retrieve in application
import { SSM } from '@aws-sdk/client-ssm';
const ssm = new SSM();
const param = await ssm.getParameter({ Name: '/ship/dev/API_KEY', WithDecryption: true });
```

## Disaster Recovery

### Backup Strategy

- **Aurora:** Automated daily backups (7-day retention)
- **Terraform state:** Version controlled in S3 (if using S3 backend)

### Recovery Procedure

1. **Restore Aurora:**
   ```bash
   aws rds restore-db-cluster-to-point-in-time \
     --source-db-cluster-identifier ship-aurora \
     --target-db-cluster-identifier ship-aurora-restored \
     --restore-to-time 2024-01-01T00:00:00Z
   ```

2. **Update Terraform to use new cluster:**
   ```hcl
   # Import restored cluster
   terraform import aws_rds_cluster.aurora ship-aurora-restored
   ```

3. **Update SSM parameters with new endpoint:**
   ```bash
   aws ssm put-parameter \
     --name "/ship/dev/DATABASE_URL" \
     --type "SecureString" \
     --value "postgresql://user:pass@new-endpoint:5432/ship_main" \
     --overwrite
   ```

## Cleanup

To destroy all resources:

```bash
# 1. Delete EB environment first (not managed by Terraform)
cd ../api
eb terminate ship-api-dev

# 2. Destroy Terraform resources
cd ../terraform
terraform destroy
```

**Warning:** This is irreversible. Ensure you have backups.

For production, consider:
- Taking a final Aurora snapshot
- Backing up S3 bucket contents
- Exporting CloudWatch logs
