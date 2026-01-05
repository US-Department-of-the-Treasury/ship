# EC2 E2E Test Runner

A beefy EC2 spot instance for running Playwright E2E tests in parallel.

## Specs

| Property | Value |
|----------|-------|
| Instance | c7i.metal-48xl |
| vCPUs | 192 |
| RAM | 384 GB |
| Storage | 200 GB gp3 (16K IOPS) |
| Pricing | Spot (~$2.50/hr) |
| Monthly | ~$1,800 (always-on) |

## Quick Start

### 1. Deploy the instance

```bash
cd terraform/test-runner

# Initialize Terraform
terraform init

# Deploy (provide your SSH key name)
terraform apply -var="key_name=your-key-name"
```

### 2. Configure SSH

Copy the SSH config from the terraform output:

```bash
terraform output ssh_config
```

Add it to `~/.ssh/config`:

```
Host test-runner
  HostName <elastic-ip>
  User ubuntu
  IdentityFile ~/.ssh/your-key-name.pem
  StrictHostKeyChecking no
  ServerAliveInterval 60
```

### 3. Wait for setup to complete

The instance needs ~5 minutes to install Node.js, PostgreSQL, and Playwright browsers.

Check progress:
```bash
ssh test-runner "tail -f /var/log/user-data.log"
```

Setup is complete when you see:
```
=== Test Runner Setup Complete ===
```

### 4. Run tests

```bash
# From repo root
./scripts/test-remote.sh

# Run specific tests
./scripts/test-remote.sh e2e/auth.spec.ts

# Run with different worker count
./scripts/test-remote.sh --workers=48

# Re-run failed tests
./scripts/test-remote.sh --last-failed
```

## Costs

| Component | Monthly Cost |
|-----------|--------------|
| c7i.metal-48xl spot | ~$1,825 |
| 200 GB gp3 EBS | ~$20 |
| Elastic IP | ~$4 |
| Data transfer | ~$10 |
| **Total** | **~$1,860/mo** |

## Spot Interruptions

This uses a **persistent** spot instance with stop-on-interruption. If AWS needs the capacity:

1. Instance stops (not terminated)
2. You wait until capacity is available
3. Instance restarts automatically
4. Your data and setup are preserved

For E2E tests, this is fine - just re-run if interrupted.

## Maintenance

### Stop instance (save money when not testing)

```bash
aws ec2 stop-instances --instance-ids $(terraform output -raw instance_id)
```

### Start instance

```bash
aws ec2 start-instances --instance-ids $(terraform output -raw instance_id)
```

### Destroy everything

```bash
terraform destroy
```

### SSH directly

```bash
ssh test-runner
```

### Check instance status

```bash
aws ec2 describe-instances --instance-ids $(terraform output -raw instance_id) \
  --query 'Reservations[0].Instances[0].State.Name' --output text
```

## Troubleshooting

### "Cannot connect to test-runner"

1. Check instance is running: `aws ec2 describe-instances ...`
2. Check security group allows your IP
3. Check SSH key path in ~/.ssh/config

### "Setup not complete"

Wait for user-data script to finish (~5 min). Check progress:
```bash
ssh test-runner "tail -50 /var/log/user-data.log"
```

### Tests fail with database errors

SSH in and check PostgreSQL:
```bash
ssh test-runner
sudo systemctl status postgresql
psql -U ship -d ship_test -c "SELECT 1"
```
