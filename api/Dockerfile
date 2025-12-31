# Use ECR Public Node.js image (Docker Hub is blocked in government environments)
FROM public.ecr.aws/docker/library/node:20-slim

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.4

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json ./api/
COPY shared/package.json ./shared/

# Disable SSL strict mode for government VPN environments
RUN npm config set strict-ssl false

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code
COPY shared/ ./shared/
COPY api/ ./api/

# Build shared types first
WORKDIR /app/shared
RUN pnpm build

# Build API
WORKDIR /app/api
RUN pnpm build

# Remove dev dependencies
WORKDIR /app
RUN pnpm install --frozen-lockfile --prod

# Expose port
EXPOSE 80

# Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=80

# Start the application
WORKDIR /app/api
CMD ["node", "dist/index.js"]
