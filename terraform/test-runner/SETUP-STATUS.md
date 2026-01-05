# EC2 Test Runner Setup Status

**Last Updated:** 2026-01-04
**Status:** Waiting for network team approval

## What's Done

- [x] Terraform deployed (c7i.metal-48xl, 192 vCPU, 384GB RAM)
- [x] Instance running: `i-0405a9e23d9db8009`
- [x] Elastic IP: `18.213.82.168`
- [x] SSH key created: `~/.ssh/ship-test-runner.pem`
- [x] SSH config added to `~/.ssh/config`
- [x] Security group allows port 22 (currently 0.0.0.0/0)

## Blocked On

Corporate firewall blocking outbound SSH to AWS IPs. Request submitted to network team.

**Request:** Allow outbound TCP port 22 to `18.213.82.168`

## Next Steps (After Approval)

1. Get corporate egress IP(s) from network team
2. Lock down security group:
   ```bash
   cd terraform/test-runner
   terraform apply -var="key_name=ship-test-runner" -var='allowed_ssh_cidrs=["CORP.IP/32"]'
   ```
3. Test SSH: `ssh test-runner "echo connected"`
4. Wait for user-data setup (~5 min if instance was rebooted)
5. Run tests: `./scripts/test-remote.sh`

## Quick Test Commands

```bash
# Test SSH connection
ssh test-runner "echo connected"

# Check setup progress
ssh test-runner "tail -f /var/log/user-data.log"

# Run E2E tests (96 workers)
./scripts/test-remote.sh
```
