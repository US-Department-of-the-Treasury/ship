# Ship - Deployment Guide

**Government-compliant AWS deployment for Express API + React frontend**

## Prerequisites

Install required tools:

```bash
# Terraform
brew install terraform

# AWS CLI
brew install awscli

# EB CLI
pip install awsebcli

# PostgreSQL client (for database initialization)
brew install postgresql@16
```

Configure AWS credentials:

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and default region
```

## Architecture Overview

```
Frontend (React) → CloudFront → S3
API (Express)    → ALB → Elastic Beanstalk (Docker) → Aurora PostgreSQL
                                                    ↓
                                            SSM Parameter Store
```

## Deployment Steps

### 1. Deploy Infrastructure (One-time)

Infrastructure includes VPC, Aurora database, S3, CloudFront, and Elastic Beanstalk application.

```bash
# Copy and configure Terraform variables
cd terraform
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your values:
# - aws_region: Your AWS region (e.g., "us-east-1")
# - project_name: "ship" (or your project name)
# - environment: "dev", "staging", or "prod"
# - route53_zone_id: (optional) Your Route53 zone ID for custom domains
# - api_domain_name: (optional) Custom API domain (e.g., "api.example.gov")
# - app_domain_name: (optional) Custom frontend domain (e.g., "app.example.gov")

# Deploy infrastructure
cd ..
./scripts/deploy-infrastructure.sh
```

**Important:** Save the Terraform outputs - you'll need them for the next steps.

**Cost:** ~$80/month for dev environment (t3.small + Aurora Serverless v2 0.5 ACU)

### 2. Initialize Elastic Beanstalk Environment (One-time)

After infrastructure is deployed, create the EB environment:

```bash
cd api
eb init
```

Follow the prompts:
- Select region (same as Terraform)
- Select application (from `terraform output eb_application_name`)
- Select platform: **Docker running on 64bit Amazon Linux 2023**
- Do not set up SSH (we'll configure security groups properly)

Create the environment:

```bash
# Get values from Terraform outputs
cd ../terraform
export EB_APP=$(terraform output -raw eb_application_name)
export EB_PROFILE=$(terraform output -raw eb_instance_profile)
export EB_SERVICE_ROLE=$(terraform output -raw eb_service_role)
export VPC_ID=$(terraform output -raw eb_vpc_id)
export PRIVATE_SUBNETS=$(terraform output -raw eb_private_subnets)
export PUBLIC_SUBNETS=$(terraform output -raw eb_public_subnets)
export INSTANCE_SG=$(terraform output -raw eb_instance_security_group)
export ALB_SG=$(terraform output -raw eb_alb_security_group)

cd ../api

# Create EB environment
eb create ship-api-dev \
  --instance-type t3.small \
  --instance-profile "$EB_PROFILE" \
  --service-role "$EB_SERVICE_ROLE" \
  --vpc.id "$VPC_ID" \
  --vpc.ec2subnets "$PRIVATE_SUBNETS" \
  --vpc.elbsubnets "$PUBLIC_SUBNETS" \
  --vpc.securitygroups "$INSTANCE_SG" \
  --vpc.elbpublic \
  --elb-type application
```

This takes 5-10 minutes. EB will:
- Create an Application Load Balancer
- Launch EC2 instances in private subnets
- Build and deploy your Docker container
- Configure health checks and auto-scaling

### 3. Initialize Database (One-time)

Apply database schema and optionally seed with test data:

```bash
./scripts/init-database.sh
```

This script:
- Fetches the DATABASE_URL from SSM Parameter Store
- Applies the schema from `api/src/db/schema.sql`
- Optionally seeds test data

### 4. Deploy API (Frequent)

After initial setup, deploy code changes with:

```bash
./scripts/deploy-api.sh
```

This is a fast operation (3-5 minutes) that:
- Builds Docker image
- Uploads to EB
- Performs rolling deployment

### 5. Deploy Frontend (Frequent)

Deploy the React frontend:

```bash
./scripts/deploy-frontend.sh
```

This script:
- Builds the React app (`pnpm build:web`)
- Syncs to S3 bucket
- Invalidates CloudFront cache

**Build takes:** 1-2 minutes
**CloudFront invalidation takes:** 1-2 minutes

## Configuration

### Environment Variables

Environment variables are managed via:
- SSM Parameter Store (for secrets)
- `.ebextensions/01-env.config` (for non-secrets)

To update environment variables:

1. **For secrets:** Update SSM Parameter Store
   ```bash
   aws ssm put-parameter \
     --name "/ship/dev/DATABASE_URL" \
     --type "SecureString" \
     --value "postgresql://..." \
     --overwrite
   ```

2. **For non-secrets:** Update `.ebextensions/01-env.config` and redeploy

### Custom Domains

To use custom domains (e.g., `api.example.gov` and `app.example.gov`):

1. Ensure DNS delegation is configured:
   ```bash
   dig +short api.example.gov NS
   dig +short app.example.gov NS
   ```

2. Update `terraform.tfvars`:
   ```hcl
   route53_zone_id  = "Z1234567890ABC"
   api_domain_name  = "api.example.gov"
   app_domain_name  = "app.example.gov"
   ```

3. Re-run Terraform:
   ```bash
   ./scripts/deploy-infrastructure.sh
   ```

4. Wait for ACM certificate validation (5-30 minutes)

## Monitoring and Logs

### View API Logs

```bash
cd api
eb logs               # View recent logs
eb logs --stream      # Stream logs in real-time
```

Or use CloudWatch Logs:
- Application: `/aws/elasticbeanstalk/ship-api/application`
- Nginx: `/aws/elasticbeanstalk/ship-api/nginx`

### View API Status

```bash
cd api
eb status            # Environment status
eb health            # Detailed health information
eb ssh               # SSH into instance
```

### View Frontend Access Logs

CloudFront access logs are disabled by default to save costs. To enable:

1. Create S3 bucket for logs
2. Update `terraform/s3-cloudfront.tf` to add logging configuration
3. Apply Terraform changes

## Troubleshooting

### API Not Starting

1. Check EB logs: `eb logs`
2. Common issues:
   - Database connection failed (check SSM parameters)
   - Port mismatch (ensure PORT=8080 in env)
   - Build failed (check Dockerfile)

### WebSocket Not Working

1. Check ALB target group health
2. Verify sticky sessions are enabled (should be in `.ebextensions/01-env.config`)
3. Check nginx configuration in `.platform/nginx/conf.d/websocket.conf`

### Database Connection Timeout

1. Check security group rules:
   ```bash
   cd terraform
   terraform state show aws_security_group_rule.aurora_ingress_from_eb
   ```

2. Verify EB instances are in private subnets
3. Check NAT Gateway is running (required for Aurora DNS resolution)

### Frontend Not Loading

1. Check CloudFront distribution status:
   ```bash
   aws cloudfront get-distribution --id $(cd terraform && terraform output -raw cloudfront_distribution_id)
   ```

2. Check S3 bucket contents:
   ```bash
   aws s3 ls s3://$(cd terraform && terraform output -raw s3_bucket_name)/
   ```

3. Wait for CloudFront invalidation to complete (1-2 minutes)

## Cost Optimization

### Development Environment

- Use Aurora Serverless v2 with `min_capacity = 0.5` (pauses when idle)
- Use t3.small instances for EB (~$15/month)
- Enable CloudFront regional restrictions if only serving US

### Production Environment

- Increase Aurora capacity for performance
- Use t3.medium or larger for EB
- Enable multi-AZ for EB (2+ instances)
- Enable Aurora read replicas if needed

## Security Compliance

This deployment follows government compliance patterns:

- **Encryption at rest:** Aurora (storage), S3 (AES256)
- **Encryption in transit:** TLS 1.2+ for all connections
- **Audit logging:** CloudTrail (API calls), VPC Flow Logs (network), CloudWatch Logs (application)
- **Secret management:** SSM Parameter Store (SecureString)
- **Network isolation:** Private subnets for compute/database, no internet-facing databases
- **Container images:** ECR Public only (no Docker Hub)

## Disaster Recovery

### Backup Strategy

- **Aurora:** Automated daily backups (7-day retention for prod)
- **S3:** Versioning enabled on frontend bucket

### Restore Procedure

1. **Database restore:**
   ```bash
   aws rds restore-db-cluster-to-point-in-time \
     --source-db-cluster-identifier ship-aurora \
     --target-db-cluster-identifier ship-aurora-restored \
     --restore-to-time 2024-01-01T00:00:00Z
   ```

2. **Frontend restore:**
   ```bash
   aws s3api list-object-versions --bucket ship-frontend-dev --prefix index.html
   aws s3api get-object --bucket ship-frontend-dev --key index.html --version-id <VERSION_ID> index.html
   ```

## Maintenance

### Update Node.js Version

1. Update Dockerfile base image:
   ```dockerfile
   FROM public.ecr.aws/docker/library/node:22-slim
   ```

2. Redeploy API: `./scripts/deploy-api.sh`

### Update Database Schema

1. Update `api/src/db/schema.sql`
2. Apply manually:
   ```bash
   DATABASE_URL=$(aws ssm get-parameter --name "/ship/dev/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)
   psql "$DATABASE_URL" -f api/src/db/schema.sql
   ```

### Terraform State Management

For production, use S3 backend for Terraform state:

1. Create S3 bucket: `ship-terraform-state`
2. Uncomment backend configuration in `terraform/versions.tf`
3. Migrate state:
   ```bash
   cd terraform
   terraform init -migrate-state
   ```

## Cleanup

To destroy all infrastructure (WARNING: irreversible):

```bash
# Delete EB environment first
cd api
eb terminate ship-api-dev

# Then destroy Terraform resources
cd ../terraform
terraform destroy
```

This will delete:
- All EC2 instances, load balancers, and networking
- Aurora database (final snapshot created if prod)
- S3 bucket (must be empty first)
- CloudFront distribution
- All SSM parameters

**Total time:** 15-20 minutes
