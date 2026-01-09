# Security Policy

## Reporting a Vulnerability

The U.S. Department of the Treasury takes security seriously. If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

**Do NOT create a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities through one of these channels:

1. **Email**: Sam Corcos (samuel.corcos@treasury.gov)
2. **GitHub Security Advisories**: Use the "Report a vulnerability" button in the Security tab

### What to Include

When reporting a vulnerability, please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity

### Scope

This security policy applies to:
- The main repository code
- Official releases
- Documentation

### Out of Scope

- Third-party dependencies (report to upstream maintainers)
- Self-hosted instances with custom modifications

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |

## Security Best Practices

When deploying Ship:

1. Keep dependencies updated
2. Use environment variables for sensitive configuration
3. Enable HTTPS in production
4. Follow your organization's security guidelines

## Development Security

### Pre-commit Compliance Checks

This repository uses `comply opensource` as a pre-commit hook that scans for:

- **Secrets**: API keys, passwords, tokens (via gitleaks)
- **Sensitive Information**: AI-powered analysis for PII, internal URLs
- **Vulnerabilities**: Container and dependency scanning (via trivy)

### NEVER Bypass Security Checks

**`git commit --no-verify` is prohibited.** This flag bypasses all pre-commit hooks and defeats the security scanning.

If you encounter a situation where you're tempted to use `--no-verify`:

| Situation | Correct Action |
|-----------|----------------|
| False positive from gitleaks | Add to `.gitleaksignore` and re-run |
| Compliance tool crashes | Report bug to compliance-toolkit repo, wait for fix |
| Need to commit urgently | No exception. Fix the issue first. |
| CI is down | Local hooks still work. CI is backup enforcement. |

### CI Enforcement

GitHub Actions provides a second layer of enforcement:

- **secrets-scan**: Runs gitleaks on every PR
- **attestation-check**: Verifies ATTESTATION.md exists and is current

These are required status checks. PRs cannot merge without passing.

### Attestation

Every commit to main should have an associated security attestation in `ATTESTATION.md`. This file:

- Records who performed the security review
- Documents which scanning tools were used
- Provides audit trail for FISMA compliance

Run `comply opensource` to update the attestation before committing.
