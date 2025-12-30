<p align="center">
  <a href="https://github.com/US-Department-of-the-Treasury/ship">
    <img src="web/public/icons/blue/android-chrome-512x512.png" alt="Ship logo" width="120">
  </a>
</p>

<h1 align="center">Ship</h1>

<p align="center">
  <strong>Open-source project management for government teams</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/US-Department-of-the-Treasury/ship/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <img src="https://img.shields.io/badge/Section_508-Compliant-blue.svg" alt="Section 508 Compliant">
  <img src="https://img.shields.io/badge/WCAG_2.1-AA-blue.svg" alt="WCAG 2.1 AA">
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

Ship is a modern project management platform built for government teams. It combines wiki-style documentation, issue tracking, and sprint planning in a unified interface with real-time collaboration.

**Developed by the U.S. Department of the Treasury** and available for use by any government agency or organization.

### Why Ship?

| Challenge | Ship's Solution |
|-----------|-----------------|
| Fragmented tools | Unified documents, issues, and sprints in one place |
| Real-time collaboration | TipTap editor with Yjs CRDTs for conflict-free editing |
| Accessibility requirements | Section 508 compliant, WCAG 2.1 AA certified |
| Data sovereignty | Self-hosted, no external telemetry or analytics |

---

## Features

<table>
<tr>
<td width="50%">

### Documents

Wiki-style documentation with real-time collaborative editing. Nest documents, embed references, and organize knowledge across your organization.

### Issues

Track work items with customizable states, assignees, and priorities. Link issues to projects and assign them to sprints.

### Projects

Group related issues into time-bounded deliverables. Track progress with completion percentages and team workload views.

</td>
<td width="50%">

### Sprints

Plan iterations with sprint documents, planning pages, and retrospectives. See team capacity and workload at a glance.

### Team View

Visualize work across team members and sprints. Identify bottlenecks and balance workload across the organization.

### Real-time Collaboration

See who's editing documents in real-time with presence indicators and live cursor positions.

</td>
</tr>
</table>

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 15+ (or Docker)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/US-Department-of-the-Treasury/ship.git
cd ship

# Install dependencies
pnpm install

# Start PostgreSQL (via Docker)
docker-compose up -d

# Seed the database
pnpm db:seed

# Start development servers
pnpm dev
```

The application will be available at:
- **Web**: http://localhost:5173
- **API**: http://localhost:3000

### Default Credentials

```
Email: dev@ship.local
Password: admin123
```

---

## Architecture

Ship uses a **unified document model** where all content types (documents, issues, projects, sprints) are stored in a single table with a `document_type` field. This enables consistent handling, linking, and real-time collaboration across all content.

### Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React, Vite, TailwindCSS | Fast dev experience, modern tooling |
| **Editor** | TipTap + Yjs | Real-time collaborative editing with CRDTs |
| **Backend** | Express, Node.js | Simple, battle-tested, same-language stack |
| **Database** | PostgreSQL | Reliable, feature-rich, direct SQL |
| **Real-time** | WebSocket | Collaboration sync and presence |

### Repository Structure

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints
│   │   ├── collaboration/  # WebSocket + Yjs sync
│   │   └── db/             # Database queries
│   └── package.json
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   └── hooks/          # Custom hooks
│   └── package.json
│
├── shared/                 # Shared TypeScript types
├── e2e/                    # Playwright E2E tests
└── docs/                   # Architecture documentation
```

### Key Design Decisions

- **Everything is a document** — Issues, projects, and sprints are all documents with different properties
- **Server is source of truth** — Offline-tolerant design with sync on reconnect
- **Boring technology** — Well-understood tools over cutting-edge experiments
- **E2E-heavy testing** — Test real user flows with Playwright, minimal unit tests

See [docs/application-architecture.md](docs/application-architecture.md) for detailed architecture decisions.

---

## Testing

```bash
# Run all E2E tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run specific test file
pnpm test e2e/documents.spec.ts
```

Ship uses Playwright for end-to-end testing with 73+ tests covering all major functionality.

---

## Deployment

Ship supports multiple deployment patterns:

| Environment | Recommended Approach |
|-------------|---------------------|
| **Development** | Local with Docker Compose |
| **Staging** | AWS Elastic Beanstalk |
| **Production** | AWS GovCloud with Terraform |

### Docker

```bash
# Build production images
docker build -t ship-api ./api
docker build -t ship-web ./web

# Run with Docker Compose
docker-compose -f docker-compose.prod.yml up
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `SESSION_SECRET` | Cookie signing secret | Required |
| `PORT` | API server port | `3000` |

---

## Accessibility

Ship is built with Section 508 compliance as a first-class requirement:

- **WCAG 2.1 AA** — All color contrasts meet 4.5:1 minimum ratio
- **Keyboard navigation** — Full keyboard support for all interactions
- **Screen reader support** — Proper ARIA labels and semantic HTML
- **Focus management** — Visible focus indicators and logical tab order

---

## Security

- **No external telemetry** — No Sentry, PostHog, or third-party analytics
- **No external CDN** — All assets served from your infrastructure
- **Session timeout** — 15-minute idle timeout (government standard)
- **Audit logging** — Track all document operations

> **Reporting Vulnerabilities:** See [SECURITY.md](./SECURITY.md) for our vulnerability disclosure policy.

---

## Contributing

We welcome contributions from the open source community. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Development Commands

```bash
pnpm dev          # Start all dev servers
pnpm dev:api      # Start API only
pnpm dev:web      # Start web only
pnpm build        # Build all packages
pnpm type-check   # Run TypeScript checks
pnpm test         # Run E2E tests
pnpm db:seed      # Seed database with test data
```

---

## Documentation

- [Application Architecture](./docs/application-architecture.md) — Tech stack and design decisions
- [Unified Document Model](./docs/unified-document-model.md) — Data model and sync architecture
- [Contributing Guidelines](./CONTRIBUTING.md) — How to contribute
- [Security Policy](./SECURITY.md) — Vulnerability reporting

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

<p align="center">
  <sub>Built for public service</sub>
</p>
