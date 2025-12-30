# Ship

A modern project management and issue tracking application built for teams.

## Features

- **Document Management**: Wiki-style documents with real-time collaboration
- **Issue Tracking**: Create, assign, and track issues across projects
- **Sprint Planning**: Organize work into sprints with visual timeline views
- **Team View**: See team workload across sprints at a glance
- **Real-time Collaboration**: TipTap-based editor with Yjs CRDT sync

## Tech Stack

- **Frontend**: React, Vite, TailwindCSS, TipTap
- **Backend**: Express, PostgreSQL
- **Real-time**: WebSocket with Yjs
- **Monorepo**: pnpm workspaces

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL

### Installation

```bash
# Clone the repository
git clone https://github.com/US-Department-of-the-Treasury/ship.git
cd ship

# Install dependencies
pnpm install

# Set up environment
cp api/.env.template api/.env.local
cp web/.env.template web/.env.local

# Start PostgreSQL and seed database
docker-compose up -d
pnpm db:seed

# Start development servers
pnpm dev
```

### Development

```bash
# Run all dev servers
pnpm dev

# Run API only
pnpm dev:api

# Run web only
pnpm dev:web

# Type checking
pnpm type-check

# Run tests
pnpm test
```

## Architecture

Ship uses a unified document model where all content types (documents, issues, projects, sprints) are stored in a single `documents` table with a `document_type` field. This enables consistent handling, linking, and collaboration across all content.

See [docs/unified-document-model.md](docs/unified-document-model.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.
