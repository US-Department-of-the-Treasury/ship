#!/bin/bash
set -e

# Log everything to /var/log/user-data.log
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== Starting Ship E2E Test Runner Setup ==="
echo "Instance type: $(curl -s http://169.254.169.254/latest/meta-data/instance-type)"
echo "Date: $(date)"

# System updates
echo "=== Updating system packages ==="
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# Install Node.js 20
echo "=== Installing Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install pnpm
echo "=== Installing pnpm ==="
corepack enable
corepack prepare pnpm@latest --activate

# Install PostgreSQL 16
echo "=== Installing PostgreSQL 16 ==="
apt-get install -y postgresql-16 postgresql-contrib-16

# Configure PostgreSQL
echo "=== Configuring PostgreSQL ==="
sudo -u postgres psql -c "CREATE USER ship WITH PASSWORD 'ship' SUPERUSER;" || true
sudo -u postgres psql -c "CREATE DATABASE ship_test OWNER ship;" || true

# Allow local connections without password (for tests)
echo "host all all 127.0.0.1/32 trust" >> /etc/postgresql/16/main/pg_hba.conf
echo "host all all ::1/128 trust" >> /etc/postgresql/16/main/pg_hba.conf
systemctl restart postgresql

# Install Playwright system dependencies
echo "=== Installing Playwright dependencies ==="
apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
  fonts-liberation fonts-noto-color-emoji xvfb

# Install additional dev tools
echo "=== Installing dev tools ==="
apt-get install -y git build-essential

# Create ship directory
echo "=== Setting up ship directory ==="
mkdir -p /home/ubuntu/ship
chown ubuntu:ubuntu /home/ubuntu/ship

# Install Playwright browsers as ubuntu user
echo "=== Installing Playwright browsers ==="
sudo -u ubuntu bash -c 'npx playwright install chromium'

# Optimize for parallel tests
echo "=== Optimizing system limits ==="
cat >> /etc/sysctl.conf << EOF
# Increase file descriptor limits
fs.file-max = 2097152

# Increase inotify watches for file system events
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192

# Network optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
EOF
sysctl -p

# Increase open file limits for ubuntu user
cat >> /etc/security/limits.conf << EOF
ubuntu soft nofile 65535
ubuntu hard nofile 65535
ubuntu soft nproc 65535
ubuntu hard nproc 65535
EOF

# Create a convenience script for running tests
cat > /home/ubuntu/run-tests.sh << 'EOF'
#!/bin/bash
cd /home/ubuntu/ship
export DATABASE_URL='postgresql://ship:ship@localhost:5432/ship_test'
pnpm install --frozen-lockfile
pnpm build
pnpm test:e2e "$@"
EOF
chmod +x /home/ubuntu/run-tests.sh
chown ubuntu:ubuntu /home/ubuntu/run-tests.sh

# Signal completion
echo "=== Test Runner Setup Complete ==="
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "PostgreSQL: $(psql --version)"
echo "Ready for tests!"

# Create completion marker
touch /home/ubuntu/.setup-complete
