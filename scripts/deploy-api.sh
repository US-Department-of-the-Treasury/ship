#!/bin/bash
set -e

echo "=========================================="
echo "Ship - API Deployment"
echo "=========================================="
echo ""

# Check if EB CLI is installed
if ! command -v eb &> /dev/null; then
    echo "Error: EB CLI is not installed"
    echo "Install with: pip install awsebcli"
    exit 1
fi

# Navigate to api directory
cd "$(dirname "$0")/../api"

# Check if .elasticbeanstalk directory exists (EB initialized)
if [ ! -d .elasticbeanstalk ]; then
    echo "Error: Elastic Beanstalk not initialized"
    echo ""
    echo "Run the following commands to initialize:"
    echo "  cd api"
    echo "  eb init"
    echo ""
    echo "Follow the prompts and use these values from Terraform output:"
    echo "  - Application: (from terraform output eb_application_name)"
    echo "  - Platform: Docker"
    echo "  - Region: us-east-1 (or your configured region)"
    echo ""
    echo "Then create an environment:"
    echo "  eb create ship-api-dev --instance-type t3.small \\"
    echo "    --instance-profile (from terraform output eb_instance_profile) \\"
    echo "    --service-role (from terraform output eb_service_role) \\"
    echo "    --vpc.id (from terraform output eb_vpc_id) \\"
    echo "    --vpc.ec2subnets (from terraform output eb_private_subnets) \\"
    echo "    --vpc.elbsubnets (from terraform output eb_public_subnets) \\"
    echo "    --vpc.securitygroups (from terraform output eb_instance_security_group) \\"
    echo "    --vpc.elbpublic"
    exit 1
fi

echo "Building and deploying API..."
echo ""

# Deploy to Elastic Beanstalk
eb deploy

echo ""
echo "=========================================="
echo "API deployment complete!"
echo "=========================================="
echo ""
echo "Check status with: eb status"
echo "View logs with: eb logs"
echo "SSH to instance: eb ssh"
